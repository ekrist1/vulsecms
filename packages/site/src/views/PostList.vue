<script setup lang="ts">
import { computed } from 'vue';
import { useEntry } from '../composables/useEntry.js';

const { state, entries } = useEntry();
const collection = computed(() => state.route.collection ?? 'posts');

function title(entry: { content: Record<string, unknown> }) {
  return String(entry.content.title ?? entry.content.headline ?? 'Untitled');
}

function href(entry: { collection: string; id: string; content: Record<string, unknown> }) {
  const slug = typeof entry.content.slug === 'string' ? entry.content.slug : entry.id;
  return `/${entry.collection}/${slug}`;
}
</script>

<template>
  <section class="site-card">
    <p class="site-eyebrow">{{ collection }}</p>
    <h1>{{ collection }}</h1>
    <div v-if="entries.length > 0" class="site-list">
      <a v-for="entry in entries" :key="entry.id" class="site-list-item" :href="href(entry)">
        <span>{{ title(entry) }}</span>
        <small>{{ entry.collection }}</small>
      </a>
    </div>
    <p v-else class="site-muted">No published entries found.</p>
  </section>
</template>
