<script setup lang="ts">
import type { BlockComponentMap } from '@vulse/renderer';
import { computed } from 'vue';
import MyAccordion from '../components/MyAccordion.vue';
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
const blockComponents = {
  vulseAccordion: MyAccordion,
} satisfies BlockComponentMap;
</script>

<template>
  <article v-if="entry" class="site-card site-entry">
    <p class="site-eyebrow">{{ entry.collection }}</p>
    <h1>{{ title }}</h1>
    <p v-if="excerpt" class="site-lead">{{ excerpt }}</p>
    <EntryBody :value="body" :components="blockComponents" />
  </article>
  <NotFound v-else />
</template>
