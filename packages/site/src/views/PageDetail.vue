<script setup lang="ts">
import { computed } from 'vue';
import { useEntry } from '../composables/useEntry.js';
import EntryBody from './EntryBody.vue';
import NotFound from './NotFound.vue';

const { entry } = useEntry();
const title = computed(() => String(entry.value?.content.title ?? 'Untitled'));
const body = computed(() => entry.value?.content.body ?? []);
</script>

<template>
  <article v-if="entry" class="site-card site-entry">
    <p class="site-eyebrow">Page</p>
    <h1>{{ title }}</h1>
    <EntryBody :value="body" />
  </article>
  <NotFound v-else />
</template>
