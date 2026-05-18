<script setup lang="ts">
import { computed } from 'vue';
import { useEntry } from '../composables/useEntry.js';
import EntryBody from './EntryBody.vue';
import NotFound from './NotFound.vue';

const { entry } = useEntry();
const title = computed(() =>
  String(entry.value?.content.title ?? entry.value?.content.headline ?? 'Untitled'),
);
const excerpt = computed(() => {
  const value = entry.value?.content.excerpt;
  return typeof value === 'string' ? value : null;
});
const body = computed(() => entry.value?.content.body ?? []);
</script>

<template>
  <article v-if="entry" class="site-card site-entry">
    <p class="site-eyebrow">{{ entry.collection }}</p>
    <h1>{{ title }}</h1>
    <p v-if="excerpt" class="site-lead">{{ excerpt }}</p>
    <EntryBody :value="body" />
  </article>
  <NotFound v-else />
</template>
