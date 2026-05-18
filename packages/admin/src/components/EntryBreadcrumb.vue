<script setup lang="ts">
import { RouterLink } from 'vue-router';

defineProps<{
  handle: string;
  items: Array<{ id: string; label: string }>;
}>();
</script>

<template>
  <nav v-if="items.length > 0" class="mb-3 flex flex-wrap items-center gap-1 text-sm text-zinc-500" aria-label="Breadcrumb">
    <RouterLink
      :to="`/collections/${handle}`"
      class="hover:text-zinc-900"
      data-testid="breadcrumb-root"
    >
      {{ handle }}
    </RouterLink>
    <template v-for="(item, i) in items" :key="item.id">
      <span class="text-zinc-300">/</span>
      <RouterLink
        v-if="i < items.length - 1"
        :to="`/collections/${handle}/${item.id}`"
        class="hover:text-zinc-900"
        :data-testid="`breadcrumb-${i}`"
      >
        {{ item.label }}
      </RouterLink>
      <span v-else class="font-medium text-zinc-700" :data-testid="`breadcrumb-${i}`">
        {{ item.label }}
      </span>
    </template>
  </nav>
</template>
