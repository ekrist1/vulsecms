<script setup lang="ts">
import { useToastsStore } from '../stores/toasts.js';

const toasts = useToastsStore();

const COLOR: Record<'success' | 'error' | 'info', string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-zinc-200 bg-white text-zinc-800',
};
</script>

<template>
  <div
    class="fixed right-4 bottom-4 z-50 flex flex-col gap-2"
    role="region"
    aria-live="polite"
    aria-atomic="false"
    aria-label="Notifications"
    data-testid="toasts"
  >
    <button
      v-for="t in toasts.list"
      :key="t.id"
      type="button"
      class="min-w-56 max-w-sm rounded border px-3 py-2 text-left text-sm shadow-sm transition hover:shadow"
      :class="COLOR[t.kind]"
      :aria-label="`Dismiss notification: ${t.message}`"
      :data-testid="`toast-${t.kind}`"
      @click="toasts.dismiss(t.id)"
    >
      {{ t.message }}
    </button>
  </div>
</template>
