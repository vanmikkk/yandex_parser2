<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api/axios'

const router = useRouter()

const email = ref('test@example.com')
const password = ref('password')

const loading = ref(false)
const error = ref('')

const login = async () => {
    error.value = ''
    loading.value = true

    try {
        await api.get('/sanctum/csrf-cookie')

        await api.post('/api/login', {
            email: email.value,
            password: password.value,
        })

        await router.push('/')
    } catch (e) {
        console.error(e)

        if (e.response?.data?.message) {
            error.value = e.response.data.message
        } else {
            error.value = 'Не удалось выполнить вход.'
        }
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <main class="login-page">
        <form class="login-form" @submit.prevent="login">
            <h1>Вход</h1>

            <label>
                Email
                <input
                    v-model="email"
                    type="email"
                    required
                >
            </label>

            <label>
                Пароль
                <input
                    v-model="password"
                    type="password"
                    required
                >
            </label>

            <p v-if="error" class="error">
                {{ error }}
            </p>

            <button type="submit" :disabled="loading">
                {{ loading ? 'Вход...' : 'Войти' }}
            </button>
        </form>
    </main>
</template>

<style scoped>
.login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.login-form {
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.login-form label {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.login-form input {
    padding: 8px;
}

.login-form button {
    padding: 10px;
}

.error {
    color: #c00;
}
</style>