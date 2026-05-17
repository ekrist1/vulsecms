<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, type ApiError } from '../api/client.js';

const route = useRoute();
const router = useRouter();
const password = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);
const done = ref(false);

async function submit() {
  error.value = null;
  submitting.value = true;
  const token = String(route.params.token ?? '');
  try {
    await api.resetPassword(token, password.value);
    done.value = true;
    setTimeout(() => router.push('/login'), 1500);
  } catch (err) {
    error.value = (err as { response?: ApiError }).response?.message ?? 'Reset failed.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto mt-24 max-w-sm rounded border border-zinc-200 bg-white p-6 shadow-sm">
    <h1 class="mb-4 text-lg font-semibold">Choose a new password</h1>
    <div v-if="done" class="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
      Password updated. Redirecting to sign-in…
    </div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">New password</span>
        <input v-model="password" type="password" required minlength="12" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>
      <div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>
      <button type="submit" class="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700" :disabled="submitting">
        {{ submitting ? 'Saving…' : 'Save new password' }}
      </button>
      <div class="text-center text-xs text-zinc-500">
        <RouterLink to="/login" class="hover:text-zinc-900">Cancel</RouterLink>
      </div>
    </form>
  </div>
</template>
