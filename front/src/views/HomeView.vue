<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api/axios'

const router = useRouter()

const organization = ref(null)
const reviews = ref([])

const url = ref('')

const loading = ref(true)
const saving = ref(false)
const loadingReviews = ref(false)

const error = ref('')
const success = ref('')

const currentPage = ref(1)
const lastPage = ref(1)

let pollingTimer = null

const isParsing = computed(() => {
    return organization.value?.parse_status === 'running'
})

const parseProgress = computed(() => {
    return Number(organization.value?.parse_progress ?? 0)
})

const parseStatus = computed(() => {
    return organization.value?.parse_status ?? 'idle'
})

const parseStatusText = computed(() => {
    switch (parseStatus.value) {
        case 'running':
            return `Парсинг отзывов... ${parseProgress.value}%`

        case 'completed':
            return 'Парсинг завершён'

        case 'failed':
            return 'Ошибка парсинга'

        default:
            return 'Готово к запуску'
    }
})

const loadedReviewsText = computed(() => {
    if (!organization.value) {
        return ''
    }

    if (isParsing.value) {
        return `Загружено примерно ${parseProgress.value}%`
    }

    return `Загружено ${Math.min(
        organization.value.reviews_count ?? 0,
        600
    )} отзывов`
})

async function loadOrganization() {
    try {
        const response = await api.get('/api/organization')

        organization.value = response.data.organization

        if (!url.value && organization.value?.yandex_url) {
            url.value = organization.value.yandex_url
        }

        return organization.value
    } catch (err) {
        if (err.response?.status === 401) {
            await router.push('/login')
            return null
        }

        throw err
    }
}

async function loadReviews(page = 1) {
    loadingReviews.value = true

    try {
        const response = await api.get('/api/organization/reviews', {
            params: {
                page,
            },
        })

        reviews.value = response.data.data
        currentPage.value = response.data.current_page
        lastPage.value = response.data.last_page
    } catch (err) {
        if (err.response?.status === 401) {
            await router.push('/login')
            return
        }

        error.value =
            err.response?.data?.message ||
            'Не удалось загрузить отзывы.'
    } finally {
        loadingReviews.value = false
    }
}

async function loadData() {
    loading.value = true
    error.value = ''

    try {
        const org = await loadOrganization()

        if (org && org.parse_status === 'completed') {
            await loadReviews(1)
        } else if (org && org.reviews_count > 0) {
            await loadReviews(1)
        }
    } catch (err) {
        error.value =
            err.response?.data?.message ||
            err.message ||
            'Не удалось загрузить данные.'
    } finally {
        loading.value = false
    }
}

function startPolling() {
    stopPolling()

    pollingTimer = setInterval(async () => {
        try {
            const org = await loadOrganization()

            if (!org) {
                return
            }

            if (org.parse_status === 'completed') {
                stopPolling()

                success.value = 'Отзывы успешно обновлены.'

                await loadReviews(1)

                return
            }

            if (org.parse_status === 'failed') {
                stopPolling()

                error.value =
                    org.parse_error ||
                    'Во время парсинга произошла ошибка.'

                return
            }
        } catch (err) {
            console.error('Polling error:', err)
        }
    }, 1500)
}

function stopPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer)
        pollingTimer = null
    }
}

async function saveOrganization() {
    error.value = ''
    success.value = ''

    if (!url.value.trim()) {
        error.value = 'Введите ссылку на организацию Яндекс Карт.'
        return
    }

    saving.value = true

    try {
        const response = await api.post('/api/organization', {
            yandex_url: url.value.trim(),
        })

        organization.value = {
            ...(response.data.organization || {}),
            parse_status: 'running',
            parse_progress: 0,
            parse_error: null,
        }

        success.value = 'Организация сохранена. Парсинг запущен.'

        startPolling()
    } catch (err) {
        error.value =
            err.response?.data?.message ||
            'Не удалось сохранить организацию.'
    } finally {
        saving.value = false
    }
}

async function refreshOrganization() {
    error.value = ''
    success.value = ''

    saving.value = true

    try {
        const response = await api.post('/api/organization/refresh')

        organization.value = response.data.organization

        success.value =
            response.data.message ||
            'Парсинг запущен.'

        startPolling()
    } catch (err) {
        if (err.response?.status === 409) {
            error.value =
                err.response?.data?.message ||
                'Парсинг уже выполняется.'

            startPolling()

            return
        }

        error.value =
            err.response?.data?.message ||
            'Не удалось запустить обновление.'
    } finally {
        saving.value = false
    }
}

async function logout() {
    try {
        await api.post('/api/logout')
    } finally {
        stopPolling()
        await router.push('/login')
    }
}

async function goToPage(page) {
    if (
        page < 1 ||
        page > lastPage.value ||
        page === currentPage.value ||
        loadingReviews.value
    ) {
        return
    }

    await loadReviews(page)

    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth',
    })
}

function formatDate(date) {
    if (!date) {
        return '—'
    }

    const value = new Date(date)

    if (Number.isNaN(value.getTime())) {
        return date
    }

    return value.toLocaleDateString('ru-RU')
}

onMounted(async () => {
    await loadData()

    if (organization.value?.parse_status === 'running') {
        startPolling()
    }
})

onBeforeUnmount(() => {
    stopPolling()
})
</script>

<template>
    <div class="page">
        <header class="header">
            <div class="container header-inner">
                <h1>Yandex Reviews Parser</h1>

                <button
                    class="button button-secondary"
                    type="button"
                    @click="logout"
                >
                    Выйти
                </button>
            </div>
        </header>

        <main class="container">
            <section class="card settings-card">
                <h2>Настройки организации</h2>

                <form @submit.prevent="saveOrganization">
                    <label for="yandex-url">
                        Ссылка на организацию в Яндекс Картах
                    </label>

                    <div class="form-row">
                        <input
                            id="yandex-url"
                            v-model="url"
                            type="url"
                            placeholder="https://yandex.ru/maps/org/..."
                            :disabled="saving || isParsing"
                        />

                        <button
                            class="button"
                            type="submit"
                            :disabled="saving || isParsing"
                        >
                            {{ saving ? 'Сохранение...' : 'Сохранить' }}
                        </button>
                    </div>
                </form>

                <div
                    v-if="error"
                    class="message message-error"
                >
                    {{ error }}
                </div>

                <div
                    v-if="success"
                    class="message message-success"
                >
                    {{ success }}
                </div>
            </section>

            <section
                v-if="organization"
                class="card organization-card"
            >
                <div class="organization-header">
                    <div>
                        <h2>
                            {{ organization.name || 'Организация' }}
                        </h2>

                        <a
                            v-if="organization.yandex_url"
                            :href="organization.yandex_url"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Открыть в Яндекс Картах
                        </a>
                    </div>

                    <button
                        class="button button-secondary"
                        type="button"
                        :disabled="saving || isParsing"
                        @click="refreshOrganization"
                    >
                        {{ isParsing ? 'Парсинг...' : 'Обновить отзывы' }}
                    </button>
                </div>

                <div class="stats">
                    <div class="stat">
                        <span class="stat-label">Рейтинг</span>
                        <strong class="stat-value">
                            {{ organization.rating ?? '—' }}
                        </strong>
                    </div>

                    <div class="stat">
                        <span class="stat-label">Оценок</span>
                        <strong class="stat-value">
                            {{ organization.ratings_count ?? 0 }}
                        </strong>
                    </div>

                    <div class="stat">
                        <span class="stat-label">Всего отзывов</span>
                        <strong class="stat-value">
                            {{ organization.reviews_count ?? 0 }}
                        </strong>
                    </div>

                    <div class="stat">
                        <span class="stat-label">Доступно для загрузки</span>
                        <strong class="stat-value">
                            {{ Math.min(organization.reviews_count ?? 0, 600) }}
                        </strong>
                    </div>
                </div>

                <div
                    v-if="isParsing"
                    class="progress-block"
                >
                    <div class="progress-header">
                        <strong>{{ parseStatusText }}</strong>

                        <span>
                            {{ parseProgress }}%
                        </span>
                    </div>

                    <div class="progress-track">
                        <div
                            class="progress-bar"
                            :style="{ width: `${parseProgress}%` }"
                        ></div>
                    </div>

                    <p class="progress-description">
                        {{ loadedReviewsText }}.
                        Не закрывайте страницу до завершения парсинга.
                    </p>
                </div>

                <div
                    v-if="parseStatus === 'failed'"
                    class="message message-error"
                >
                    <strong>Парсинг завершился с ошибкой.</strong>

                    <div v-if="organization.parse_error">
                        {{ organization.parse_error }}
                    </div>
                </div>

                <div
                    v-if="parseStatus === 'completed'"
                    class="parse-info"
                >
                    {{ parseStatusText }}.
                    {{
                        organization.last_parsed_at
                            ? `Последнее обновление: ${formatDate(organization.last_parsed_at)}`
                            : ''
                    }}
                </div>
            </section>

            <section
                v-if="organization && !isParsing"
                class="card reviews-card"
            >
                <div class="reviews-header">
                    <div>
                        <h2>Отзывы</h2>

                        <p>
                            Показано {{ reviews.length }}
                            отзывов на странице
                        </p>
                    </div>

                    <div
                        v-if="lastPage > 1"
                        class="page-info"
                    >
                        Страница {{ currentPage }} из {{ lastPage }}
                    </div>
                </div>

                <div
                    v-if="loadingReviews"
                    class="loading"
                >
                    Загрузка отзывов...
                </div>

                <div
                    v-else-if="reviews.length === 0"
                    class="empty"
                >
                    Отзывов пока нет.
                </div>

                <div
                    v-else
                    class="reviews-list"
                >
                    <article
                        v-for="review in reviews"
                        :key="review.id"
                        class="review"
                    >
                        <div class="review-header">
                            <div>
                                <strong>
                                    {{ review.author || 'Анонимный пользователь' }}
                                </strong>

                                <div class="review-date">
                                    {{ formatDate(review.published_at) }}
                                </div>
                            </div>

                            <div class="review-rating">
                                {{ '★'.repeat(Number(review.rating || 0)) }}
                                <span>
                                    {{ review.rating }}/5
                                </span>
                            </div>
                        </div>

                        <p class="review-text">
                            {{ review.text || 'Без текста' }}
                        </p>
                    </article>
                </div>

                <div
                    v-if="lastPage > 1"
                    class="pagination"
                >
                    <button
                        class="page-button"
                        type="button"
                        :disabled="currentPage === 1 || loadingReviews"
                        @click="goToPage(currentPage - 1)"
                    >
                        ←
                    </button>

                    <button
                        v-for="page in lastPage"
                        :key="page"
                        class="page-button"
                        :class="{ active: page === currentPage }"
                        type="button"
                        :disabled="loadingReviews"
                        @click="goToPage(page)"
                    >
                        {{ page }}
                    </button>

                    <button
                        class="page-button"
                        type="button"
                        :disabled="
                            currentPage === lastPage ||
                            loadingReviews
                        "
                        @click="goToPage(currentPage + 1)"
                    >
                        →
                    </button>
                </div>
            </section>

            <section
                v-if="loading"
                class="card loading"
            >
                Загрузка...
            </section>
        </main>
    </div>
</template>

<style scoped>
:global(body) {
    margin: 0;
    font-family:
        Inter,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        Helvetica,
        Arial,
        sans-serif;
}

* {
    box-sizing: border-box;
}

.page {
    min-height: 100vh;
    background: #f5f6f8;
    color: #1f2937;
}

.container {
    width: min(1100px, calc(100% - 32px));
    margin: 0 auto;
}

.header {
    background: #ffffff;
    border-bottom: 1px solid #e5e7eb;
}

.header-inner {
    min-height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
}

.header h1 {
    margin: 0;
    font-size: 22px;
}

main {
    padding: 32px 0 60px;
}

.card {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;
}

.card h2 {
    margin: 0 0 20px;
    font-size: 20px;
}

label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 600;
}

.form-row {
    display: flex;
    gap: 12px;
}

input {
    min-width: 0;
    flex: 1;
    height: 44px;
    padding: 0 14px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font: inherit;
}

input:focus {
    outline: 2px solid #dbeafe;
    border-color: #2563eb;
}

input:disabled {
    background: #f3f4f6;
}

.button {
    min-height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 8px;
    background: #2563eb;
    color: #ffffff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
}

.button:hover:not(:disabled) {
    opacity: 0.9;
}

.button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.button-secondary {
    background: #374151;
}

.message {
    margin-top: 16px;
    padding: 12px 14px;
    border-radius: 8px;
    font-size: 14px;
}

.message-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
}

.message-success {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    color: #166534;
}

.organization-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
}

.organization-header h2 {
    margin-bottom: 6px;
}

.organization-header a {
    color: #2563eb;
    text-decoration: none;
    font-size: 14px;
}

.organization-header a:hover {
    text-decoration: underline;
}

.stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-top: 24px;
}

.stat {
    padding: 16px;
    background: #f9fafb;
    border-radius: 10px;
}

.stat-label {
    display: block;
    margin-bottom: 6px;
    color: #6b7280;
    font-size: 13px;
}

.stat-value {
    font-size: 22px;
}

.progress-block {
    margin-top: 24px;
    padding: 18px;
    background: #f9fafb;
    border-radius: 10px;
}

.progress-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
}

.progress-track {
    width: 100%;
    height: 12px;
    overflow: hidden;
    background: #e5e7eb;
    border-radius: 999px;
}

.progress-bar {
    height: 100%;
    background: #2563eb;
    border-radius: inherit;
    transition: width 0.5s ease;
}

.progress-description,
.parse-info {
    margin: 10px 0 0;
    color: #6b7280;
    font-size: 14px;
}

.reviews-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 20px;
}

.reviews-header h2 {
    margin-bottom: 4px;
}

.reviews-header p {
    margin: 0;
    color: #6b7280;
    font-size: 14px;
}

.page-info {
    color: #6b7280;
    font-size: 14px;
}

.review {
    padding: 20px 0;
    border-top: 1px solid #e5e7eb;
}

.review:first-child {
    border-top: 0;
    padding-top: 0;
}

.review-header {
    display: flex;
    justify-content: space-between;
    gap: 20px;
}

.review-date {
    margin-top: 4px;
    color: #6b7280;
    font-size: 13px;
}

.review-rating {
    white-space: nowrap;
    color: #f59e0b;
}

.review-rating span {
    margin-left: 6px;
    color: #6b7280;
    font-size: 13px;
}

.review-text {
    margin: 12px 0 0;
    line-height: 1.6;
    white-space: pre-wrap;
}

.pagination {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 24px;
}

.page-button {
    min-width: 38px;
    height: 38px;
    padding: 0 10px;
    border: 1px solid #d1d5db;
    border-radius: 7px;
    background: #ffffff;
    cursor: pointer;
}

.page-button:hover:not(:disabled) {
    background: #f3f4f6;
}

.page-button.active {
    background: #2563eb;
    border-color: #2563eb;
    color: #ffffff;
}

.page-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.loading,
.empty {
    padding: 30px 0;
    text-align: center;
    color: #6b7280;
}

@media (max-width: 800px) {
    .stats {
        grid-template-columns: repeat(2, 1fr);
    }

    .organization-header,
    .reviews-header {
        flex-direction: column;
    }
}

@media (max-width: 600px) {
    .form-row {
        flex-direction: column;
    }

    .stats {
        grid-template-columns: 1fr;
    }

    .review-header {
        flex-direction: column;
        gap: 8px;
    }
}
</style>