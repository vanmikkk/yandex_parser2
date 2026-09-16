const puppeteer = require('puppeteer');
const fs = require('fs');
const crypto = require('crypto');

const MAX_AVAILABLE_REVIEWS = 600;

const emitProgress = (collected, target = MAX_AVAILABLE_REVIEWS) => {
    const safeTarget = Math.max(
        1,
        Math.min(target, MAX_AVAILABLE_REVIEWS)
    );

    const safeCollected = Math.min(
        collected,
        safeTarget
    );

    console.error(
        `PROGRESS: ${safeCollected}/${safeTarget}`
    );
};

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
        headless: true,

        defaultViewport: {
            width: 1280,
            height: 900,
            deviceScaleFactor: 1,
        },

        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1280,900',
        ],
    });

    try {
        const page = await browser.newPage();

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/131.0.0.0 Safari/537.36'
        );

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        });

        const reviews = new Map();

        let totalReviews = null;
        let lastPage = 0;

        let apiReviewsReceived = false;

        // Информация о страницах отзывов от Yandex
        let totalPages = null;
        let reviewsRemained = null;
        let reachedLastPage = false;

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

                reviews.set(
                    review.reviewId,
                    review
                );
            }

            return {
                newReviews,
                duplicateReviews,
            };
        };

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
                        ratingElement?.getAttribute(
                            'aria-label'
                        ) ?? '';

                    const ratingMatch =
                        ratingText.match(
                            /(\d+(?:[.,]\d+)?)/
                        );

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


        page.on('request', (request) => {
            if (
                !request
                    .url()
                    .includes(
                        '/maps/api/business/fetchReviews'
                    )
            ) {
                return;
            }

            console.error(
                'FETCH REVIEWS REQUEST:',
                request.url()
            );
        });

        page.on('response', async (response) => {
            if (
                !response
                    .url()
                    .includes(
                        '/maps/api/business/fetchReviews'
                    )
            ) {
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

                if (pageReviews.length > 0) {
                    apiReviewsReceived = true;
                }

                const params =
                    json?.data?.params ?? {};

                totalReviews =
                    params.count ?? totalReviews;

                const currentPage = Number(
                    params.page ?? 0
                );

                if (
                    params.totalPages !== undefined &&
                    params.totalPages !== null
                ) {
                    totalPages = Number(
                        params.totalPages
                    );
                }

                if (
                    params.reviewsRemained !== undefined &&
                    params.reviewsRemained !== null
                ) {
                    reviewsRemained = Number(
                        params.reviewsRemained
                    );
                }

                if (
                    totalPages !== null &&
                    totalPages > 0 &&
                    currentPage >= totalPages
                ) {
                    reachedLastPage = true;
                }

                if (
                    reviewsRemained !== null &&
                    reviewsRemained === 0
                ) {
                    reachedLastPage = true;
                }

                const {
                    newReviews,
                    duplicateReviews,
                } = addReviews(pageReviews);

                if (currentPage > lastPage) {
                    lastPage = currentPage;
                }

                const targetReviews = Math.min(
                    totalReviews ??
                        MAX_AVAILABLE_REVIEWS,
                    MAX_AVAILABLE_REVIEWS
                );

                console.error(
                    `page=${currentPage}, ` +
                    `received=${pageReviews.length}, ` +
                    `new=${newReviews}, ` +
                    `duplicates=${duplicateReviews}, ` +
                    `collected=${reviews.size}/${totalReviews ?? '?'}, ` +
                    `totalPages=${totalPages ?? '?'}, ` +
                    `reviewsRemained=${reviewsRemained ?? '?'}`
                );

                emitProgress(
                    reviews.size,
                    targetReviews
                );
            } catch (error) {
                console.error(
                    'Failed to process fetchReviews:',
                    error.message
                );
            }
        });

        console.error(
            'Opening Yandex Maps...'
        );

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });

        console.error(
            'Page loaded.'
        );

        await new Promise(
            resolve => setTimeout(resolve, 5000)
        );

        await page.waitForSelector(
            '.business-reviews-card-view__title',
            {
                visible: true,
                timeout: 30000,
            }
        );

        const reviewsPageReady =
            await page.evaluate(() => {
                const title =
                    document.querySelector(
                        '.business-reviews-card-view__title'
                    );

                const reviewsContainer =
                    document.querySelector(
                        '.business-reviews-card-view__reviews-container'
                    );

                return Boolean(
                    title &&
                    reviewsContainer
                );
            });

        if (!reviewsPageReady) {
            throw new Error(
                'Не удалось обнаружить блок отзывов Яндекс Карт. ' +
                'Возможно, изменилась структура страницы или открыта не вкладка «Отзывы».'
            );
        }

        try {
            await page.waitForFunction(
                () => {
                    const reviewCards =
                        document.querySelectorAll(
                            '.business-reviews-card-view__review'
                        );

                    const reviewsTitle =
                        document.querySelector(
                            '.business-reviews-card-view__title'
                        );

                    const reviewsContainer =
                        document.querySelector(
                            '.business-reviews-card-view__reviews-container'
                        );

                    return (
                        reviewCards.length > 0 ||
                        Boolean(
                            reviewsTitle &&
                            reviewsContainer
                        )
                    );
                },
                {
                    timeout: 30000,
                }
            );
        } catch (error) {
            throw new Error(
                'Не удалось обнаружить блок отзывов Яндекс Карт. ' +
                'Возможно, изменилась структура страницы, ' +
                'страница не успела загрузиться или открыта не вкладка «Отзывы».'
            );
        }

        const organizationInfo =
            await page.evaluate(() => {
                const name =
                    document
                        .querySelector('h1')
                        ?.innerText
                        ?.trim() ?? null;

                const summary =
                    document
                        .querySelector(
                            '.card-reviews-view__summary'
                        )
                        ?.innerText
                        ?.trim() ?? '';

                const ratingMatch =
                    summary.match(
                        /Рейтинг\s*[\r\n]+([\d.,]+)/
                    );

                const ratingsCountMatch =
                    summary.match(
                        /([\d\s]+)\s+оценок/
                    );

                const reviewsHeader =
                    document
                        .querySelector(
                            '.business-reviews-card-view__title'
                        )
                        ?.innerText
                        ?.trim() ?? '';

                const reviewsCountMatch =
                    reviewsHeader.match(
                        /([\d\s]+)\s+отзыв/
                    );

                return {
                    name,

                    rating: ratingMatch
                        ? Number(
                            ratingMatch[1]
                                .replace(',', '.')
                        )
                        : null,

                    ratingsCount:
                        ratingsCountMatch
                            ? Number(
                                ratingsCountMatch[1]
                                    .replace(/\s/g, '')
                            )
                            : 0,

                    reviewsCount:
                        reviewsCountMatch
                            ? Number(
                                reviewsCountMatch[1]
                                    .replace(/\s/g, '')
                            )
                            : 0,
                };
            });

        console.error(
            'Organization info:',
            JSON.stringify(
                organizationInfo,
                null,
                2
            )
        );

        if (
            totalReviews === null &&
            organizationInfo.reviewsCount > 0
        ) {
            totalReviews =
                organizationInfo.reviewsCount;
        }

        const targetReviews = Math.min(
            totalReviews ??
                organizationInfo.reviewsCount ??
                MAX_AVAILABLE_REVIEWS,
            MAX_AVAILABLE_REVIEWS
        );

        console.error(
            `Target reviews: ${targetReviews}`
        );

        const initialDomReviews =
            await collectInitialDomReviews();

        if (
            initialDomReviews.length === 0 &&
            !apiReviewsReceived
        ) {
            throw new Error(
                'Яндекс не вернул отзывы: блок отзывов найден, ' +
                'но карточки отзывов и API-ответ отсутствуют. ' +
                'Возможно, изменилась структура страницы.'
            );
        }

        console.error(
            'First DOM review:',
            JSON.stringify(
                initialDomReviews[0],
                null,
                2
            )
        );

        console.error(
            `Initial DOM reviews: ${initialDomReviews.length}`
        );

        if (!apiReviewsReceived) {
            for (const review of initialDomReviews) {
                const externalId =
                    createDomReviewId(review);

                reviews.set(
                    externalId,
                    {
                        reviewId: externalId,
                        businessId: null,
                        author: {
                            name: review.author,
                        },
                        rating: review.rating,
                        text: review.text,
                        updatedTime:
                            review.publishedAt,
                    }
                );
            }

            console.error(
                `Initial DOM reviews added: ${initialDomReviews.length}`
            );
        } else {
            console.error(
                'Skipping DOM reviews because API reviews were already received.'
            );
        }

        console.error(
            `Initial reviews collected: ${reviews.size}/${targetReviews}`
        );

        emitProgress(
            reviews.size,
            targetReviews
        );

        let noProgressCount = 0;
        let previousReviewsCount =
            reviews.size;

        for (
            let i = 0;
            i < 1000;
            i++
        ) {
            if (
                reviews.size >= targetReviews
            ) {
                console.error('');

                console.error(
                    `All available reviews collected: ${reviews.size}/${targetReviews}`
                );

                break;
            }

            if (reachedLastPage) {
                console.error('');

                console.error(
                    `Reached last available page. ` +
                    `Collected ${reviews.size}/${targetReviews}`
                );

                break;
            }

            const scrollResult =
                await page.evaluate(() => {
                    const container =
                        document.querySelector(
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
                        new Event(
                            'scroll',
                            {
                                bubbles: true,
                            }
                        )
                    );

                    return {
                        found: true,
                        scrollTop:
                            container.scrollTop,
                        scrollHeight:
                            container.scrollHeight,
                        clientHeight:
                            container.clientHeight,
                    };
                });

            if (!scrollResult.found) {
                console.error(
                    'Yandex scroll container not found.'
                );

                break;
            }

            console.error(
                `Scroll: ` +
                `top=${scrollResult.scrollTop}, ` +
                `height=${scrollResult.scrollHeight}, ` +
                `client=${scrollResult.clientHeight}`
            );


            const scrollContainer =
                await page.$(
                    '.scroll__container'
                );

            if (scrollContainer) {
                const box =
                    await scrollContainer.boundingBox();

                if (box) {
                    await page.mouse.move(
                        box.x +
                            box.width / 2,
                        box.y +
                            box.height / 2
                    );

                    await page.mouse.wheel({
                        deltaY: 600,
                    });
                }
            }

            await new Promise(
                resolve => setTimeout(resolve, 3000)
            );

            console.error(
                `Progress: ${reviews.size}/${targetReviews}`
            );

            emitProgress(
                reviews.size,
                targetReviews
            );

            if (
                reviews.size ===
                previousReviewsCount
            ) {
                noProgressCount++;
            } else {
                noProgressCount = 0;

                previousReviewsCount =
                    reviews.size;
            }

            if (
                reviews.size >= targetReviews
            ) {
                console.error(
                    `Target reached: ${reviews.size}/${targetReviews}`
                );

                break;
            }

            if (reachedLastPage) {
                console.error(
                    `Reached last available page. ` +
                    `Collected ${reviews.size}/${targetReviews}`
                );

                break;
            }

            if (
                noProgressCount >= 30
            ) {
                console.error(
                    `ERROR: No new reviews were received for 30 scrolls. ` +
                    `Collected ${reviews.size}/${targetReviews}. ` +
                    `Yandex reports ${Math.max(
                        targetReviews -
                            reviews.size,
                        0
                    )} reviews remaining.`
                );

                break;
            }
        }

        const finalReviews = [
            ...reviews.values(),
        ].slice(
            0,
            MAX_AVAILABLE_REVIEWS
        );

        const collectionComplete =
            finalReviews.length >=
                targetReviews ||
            reachedLastPage;

        const result = {
            businessId:
                finalReviews[0]?.businessId ??
                null,

            name:
                organizationInfo.name,

            rating:
                organizationInfo.rating,

            ratingsCount:
                organizationInfo.ratingsCount,

            totalReviews:
                organizationInfo.reviewsCount ||
                totalReviews,

            availableReviews:
                targetReviews,

            collectedReviews:
                finalReviews.length,

            collectionComplete,

            lastPage,

            reviews:
                finalReviews,
        };

        fs.writeFileSync(
            outputFile,
            JSON.stringify(
                result,
                null,
                2
            ),
            'utf8'
        );

        console.error('');

        console.error(
            '========== RESULT =========='
        );

        console.error(
            `Unique reviews:    ${finalReviews.length}`
        );

        console.error(
            `Total reviews:     ${
                totalReviews ?? 'unknown'
            }`
        );

        console.error(
            `Available reviews: ${targetReviews}`
        );

        console.error(
            `Collection complete: ${
                collectionComplete
            }`
        );

        console.error(
            `Last page:         ${lastPage}`
        );

        console.error(
            `Total pages:       ${
                totalPages ?? 'unknown'
            }`
        );

        console.error(
            `Reviews remained:  ${
                reviewsRemained ?? 'unknown'
            }`
        );

        console.error(
            `Output file:       ${outputFile}`
        );

        console.error(
            '============================'
        );
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