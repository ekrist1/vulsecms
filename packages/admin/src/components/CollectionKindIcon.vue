<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    singleton: boolean;
    decorative?: boolean;
  }>(),
  { decorative: true },
);

const label = computed(() => (props.singleton ? 'Singleton collection' : 'Collection'));
</script>

<template>
  <span
    class="inline-flex h-4 w-4 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500"
    :title="label"
    :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="decorative ? undefined : label"
    :data-testid="singleton ? 'collection-kind-singleton' : 'collection-kind-collection'"
  >
    <svg
      v-if="singleton"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.25"
      class="h-3 w-3"
    >
      <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.75" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
    <svg
      v-else
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.25"
      class="h-3 w-3"
    >
      <rect x="2.75" y="3" width="7.75" height="7.75" rx="1.5" />
      <rect x="5.5" y="5.25" width="7.75" height="7.75" rx="1.5" />
    </svg>
  </span>
</template>
