<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api/axios'

const router = useRouter()
const user = ref(null)
const loading = ref(true)

const logout = async () => {
    try {
        await api.post('/api/logout')
    } finally {
        await router.push('/login')
    }
}

onMounted(async () => {
    try {
        const response = await api.get('/api/me')
        user.value = response.data.user
    } catch (e) {
        await router.push('/login')
    } finally {
        loading.value = false
    }
})
</script>

<template>
    <main>
        <h1>Yandex Parser</h1>

        <p v-if="loading">
            Загрузка...
        </p>

        <template v-else>
            <p>
                Вы вошли как:
                <strong>{{ user?.email }}</strong>
            </p>

            <button @click="logout">
                Выйти
            </button>
        </template>
    </main>
</template>