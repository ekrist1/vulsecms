<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { type ApiError } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

async function submit() {
  error.value = null;
  submitting.value = true;
  try {
    await auth.login(email.value, password.value);
    if (auth.user?.role === 'external_user') {
      await auth.logout();
      error.value = 'This account cannot access the admin.';
      return;
    }
    const target = (router.currentRoute.value.query.redirect as string | undefined) ?? '/';
    router.push(target);
  } catch (err) {
    const e = err as { response?: ApiError };
    error.value = e.response?.message ?? 'Sign-in failed.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto mt-24 max-w-sm rounded border border-zinc-200 bg-white p-6 shadow-sm">
    <h1 class="mb-4 text-lg font-semibold">Sign in to Vulse</h1>
    <form class="space-y-3" @submit.prevent="submit">
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Email</span>
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          required
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          data-testid="login-email"
        />
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Password</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          data-testid="login-password"
        />
      </label>
      <div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="login-error">
        {{ error }}
      </div>
      <button
        type="submit"
        class="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        :disabled="submitting"
        data-testid="login-submit"
      >
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
      <div class="text-center text-xs text-zinc-500">
        <RouterLink to="/forgot-password" class="hover:text-zinc-900">Forgot password?</RouterLink>
      </div>
    </form>
  </div>
</template>
