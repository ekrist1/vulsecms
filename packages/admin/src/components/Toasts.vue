<script setup lang="ts">
import { useToastsStore } from '../stores/toasts.js';

const toasts = useToastsStore();

const colorFor = (kind: 'success' | 'error' | 'info') => {
  if (kind === 'success') return 'border-green-200 bg-green-50 text-green-800';
  if (kind === 'error') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-zinc-200 bg-white text-zinc-800';
};
</script>

<template>
  <div class="fixed right-4 bottom-4 z-50 flex flex-col gap-2" data-testid="toasts">
    <button
      v-for="t in toasts.list"
      :key="t.id"
      type="button"
      class="min-w-[14rem] max-w-sm rounded border px-3 py-2 text-left text-sm shadow-sm transition hover:shadow"
      :class="colorFor(t.kind)"
      :data-testid="`toast-${t.kind}`"
      @click="toasts.dismiss(t.id)"
    >
      {{ t.message }}
    </button>
  </div>
</template>
