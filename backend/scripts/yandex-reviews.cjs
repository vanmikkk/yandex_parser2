const puppeteer = require('puppeteer');
const fs = require('fs');
const crypto = require('crypto');

const MAX_AVAILABLE_REVIEWS = 600;

const url = process.argv[2];
const outputFile = process.argv[3];

if (!url || !outputFile) {
    console.error(
        'Usage: node scripts/yandex-reviews.cjs "<url>" "<output-file>"'
    );

    process.exit(1);
}

(async () => {
    const browser = await puppeteer.launch({
        headless: false,

        defaultViewport: {
            width: 1280,
            height: 900,
        },
    });

    try {
        const page = await browser.newPage();

        const reviews = new Map();

        let totalReviews = null;
        let lastPage = 0;

        const createDomReviewId = (review) => {
            return crypto
                .createHash('sha256')
                .update(
                    JSON.stringify({
                        author: review.author,
                        date: review.publishedAt,
                        rating: review.rating,
                        text: review.text,
                    })
                )
                .digest('hex');
        };

        const addReviews = (pageReviews) => {
            let newReviews = 0;
            let duplicateReviews = 0;

            for (const review of pageReviews) {
                if (!review.reviewId) {
                    continue;
                }

                if (reviews.has(review.reviewId)) {
                    duplicateReviews++;
                } else {
                    newReviews++;
                }

                reviews.set(review.reviewId, review);
            }

            return {
                newReviews,
                duplicateReviews,
            };
        };

        /*
         * Получаем первые 50 отзывов непосредственно из DOM.
         *
         * При первоначальной загрузке Yandex уже показывает
         * первые 50 отзывов, но fetchReviews?page=1 мы не получаем.
         */
        const collectInitialDomReviews = async () => {
            const domReviews = await page.evaluate(() => {
                return [
                    ...document.querySelectorAll(
                        '.business-reviews-card-view__review'
                    ),
                ].map((card) => {
                    const author =
                        card.querySelector(
                            '.business-review-view__author-name'
                        )?.innerText?.trim() ?? null;

                    const dateElement =
                        card.querySelector(
                            '[itemprop="datePublished"]'
                        );

                    const date =
                        dateElement?.getAttribute('content') ??
                        dateElement?.getAttribute('datetime') ??
                        card.querySelector(
                            '.business-review-view__date'
                        )?.innerText?.trim() ??
                        null;

                    const text =
                        card.querySelector(
                            '.business-review-view__body'
                        )?.innerText?.trim() ?? null;

                    const ratingElement =
                        card.querySelector(
                            '.business-rating-badge-view__stars'
                        );

                    const ratingText =
                        ratingElement?.getAttribute('aria-label') ?? '';

                    const ratingMatch =
                        ratingText.match(/(\d+(?:[.,]\d+)?)/);

                    const rating = ratingMatch
                        ? Number(
                            ratingMatch[1].replace(',', '.')
                        )
                        : null;

                    return {
                        author,
                        publishedAt: date,
                        rating,
                        text,
                    };
                });
            });

            return domReviews;
        };

        /*
         * Логируем реальные fetchReviews requests.
         */
        page.on('request', (request) => {
            if (!request.url().includes('/maps/api/business/fetchReviews')) {
                return;
            }

            console.error(
                'FETCH REVIEWS REQUEST:',
                request.url()
            );
        });

        /*
         * Получаем последующие страницы отзывов через
         * внутренний API, который использует сам браузер Yandex.
         */
        page.on('response', async (response) => {
            if (!response.url().includes('/maps/api/business/fetchReviews')) {
                return;
            }

            if (response.status() !== 200) {
                console.error(
                    `FETCH REVIEWS RESPONSE: ${response.status()}`
                );

                return;
            }

            try {
                const body = await response.text();

                const json = JSON.parse(body);

                const pageReviews =
                    json?.data?.reviews ?? [];

                const params =
                    json?.data?.params ?? {};

                totalReviews =
                    params.count ?? totalReviews;

                const currentPage =
                    params.page ?? 0;

                const {
                    newReviews,
                    duplicateReviews,
                } = addReviews(pageReviews);

                if (currentPage > lastPage) {
                    lastPage = currentPage;
                }

                console.error(
                    `page=${currentPage}, ` +
                    `received=${pageReviews.length}, ` +
                    `new=${newReviews}, ` +
                    `duplicates=${duplicateReviews}, ` +
                    `collected=${reviews.size}/${totalReviews ?? '?'}`
                );
            } catch (error) {
                console.error(
                    'Failed to process fetchReviews:',
                    error.message
                );
            }
        });

        console.error('Opening Yandex Maps...');

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });

        console.error('Page loaded.');

        /*
         * Даём Yandex полностью отрисовать первые отзывы.
         */
        await new Promise(resolve => setTimeout(resolve, 5000));

        /*
         * Забираем первые 50 отзывов из DOM.
         */
        const initialDomReviews =
            await collectInitialDomReviews();

        console.error(
            'First DOM review:',
            JSON.stringify(initialDomReviews[0], null, 2)
        );

        console.error(
            `Initial DOM reviews: ${initialDomReviews.length}`
        );

        for (const review of initialDomReviews) {
            const externalId =
                createDomReviewId(review);

            reviews.set(externalId, {
                reviewId: externalId,
                businessId: null,
                author: {
                    name: review.author,
                },
                rating: review.rating,
                text: review.text,
                updatedTime: review.publishedAt,
            });
        }

        console.error(
            `Initial reviews collected: ${reviews.size}/${MAX_AVAILABLE_REVIEWS}`
        );

        /*
         * Теперь прокручиваем конкретно контейнер отзывов.
         */
       let noProgressCount = 0;
        let previousReviewsCount = reviews.size;

        for (let i = 0; i < 1000; i++) {
            const targetReviews = Math.min(
                totalReviews ?? MAX_AVAILABLE_REVIEWS,
                MAX_AVAILABLE_REVIEWS
            );

            if (reviews.size >= targetReviews) {
                console.error('');
                console.error(
                    `All available reviews collected: ${reviews.size}/${targetReviews}`
                );

                break;
            }

            const scrollResult = await page.evaluate(() => {
                const container = document.querySelector(
                    '.scroll__container'
                );

                if (!container) {
                    return {
                        found: false,
                        scrollTop: null,
                        scrollHeight: null,
                        clientHeight: null,
                    };
                }

                container.scrollTop += 1200;

                container.dispatchEvent(
                    new Event('scroll', {
                        bubbles: true,
                    })
                );

                return {
                    found: true,
                    scrollTop: container.scrollTop,
                    scrollHeight: container.scrollHeight,
                    clientHeight: container.clientHeight,
                };
            });

            if (!scrollResult.found) {
                console.error(
                    'Yandex scroll container not found.'
                );

                break;
            }

            console.error(
                `Scroll: top=${scrollResult.scrollTop}, ` +
                `height=${scrollResult.scrollHeight}, ` +
                `client=${scrollResult.clientHeight}`
            );

            /*
            * Дополнительно используем настоящее колесо мыши.
            */
            const scrollContainer = await page.$(
                '.scroll__container'
            );

            if (scrollContainer) {
                const box = await scrollContainer.boundingBox();

                if (box) {
                    await page.mouse.move(
                        box.x + box.width / 2,
                        box.y + box.height / 2
                    );

                    await page.mouse.wheel({
                        deltaY: 600,
                    });
                }
            }

            await new Promise(resolve => setTimeout(resolve, 3000));

            console.error(
                `Progress: ${reviews.size}/${targetReviews}`
            );

            if (reviews.size === previousReviewsCount) {
                noProgressCount++;
            } else {
                noProgressCount = 0;
                previousReviewsCount = reviews.size;
            }

            if (noProgressCount >= 30) {
                console.error(
                    'Stopping: no new reviews were received for 30 scrolls.'
                );

                break;
            }
        }

        /*
         * Ограничиваем результат максимум 600 отзывами.
         */
        const finalReviews = [
            ...reviews.values(),
        ].slice(0, MAX_AVAILABLE_REVIEWS);

        const result = {
            businessId:
                finalReviews[0]?.businessId ?? null,

            totalReviews,

            availableReviews: Math.min(
                totalReviews ?? finalReviews.length,
                MAX_AVAILABLE_REVIEWS
            ),

            collectedReviews: finalReviews.length,

            lastPage,

            reviews: finalReviews,
        };

        fs.writeFileSync(
            outputFile,
            JSON.stringify(result, null, 2),
            'utf8'
        );

        console.error('');
        console.error('========== RESULT ==========');
        console.error(
            `Unique reviews:    ${finalReviews.length}`
        );
        console.error(
            `Total reviews:     ${totalReviews ?? 'unknown'}`
        );
        console.error(
            `Available reviews: ${Math.min(
                totalReviews ?? finalReviews.length,
                MAX_AVAILABLE_REVIEWS
            )}`
        );
        console.error(
            `Last page:         ${lastPage}`
        );
        console.error(
            `Output file:       ${outputFile}`
        );
        console.error('============================');
    } catch (error) {
        console.error(
            'ERROR:',
            error.message
        );

        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();