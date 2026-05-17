<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type ApiError } from '../api/client.js';

const email = ref('');
const submitting = ref(false);
const sent = ref(false);
const error = ref<string | null>(null);

async function submit() {
  error.value = null;
  submitting.value = true;
  try {
    await api.forgotPassword(email.value);
    sent.value = true;
  } catch (err) {
    error.value = (err as { response?: ApiError }).response?.message ?? 'Could not send reset email.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto mt-24 max-w-sm rounded border border-zinc-200 bg-white p-6 shadow-sm">
    <h1 class="mb-4 text-lg font-semibold">Reset your password</h1>
    <div v-if="sent" class="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
      If that account exists, a reset link has been sent.
    </div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Email</span>
        <input v-model="email" type="email" required class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>
      <div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>
      <button type="submit" class="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700" :disabled="submitting">
        {{ submitting ? 'Sending…' : 'Send reset link' }}
      </button>
      <div class="text-center text-xs text-zinc-5000">
        <RouterLink to="/login" class="hover:text-zinc-900">Back to sign-in</RouterLink>
      </div>
    </form>
  </div>
</template>
