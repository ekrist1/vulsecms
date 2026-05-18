<script setup lang="ts">
import { computed } from 'vue';
import { useEntry } from '../composables/useEntry.js';
import EntryBody from './EntryBody.vue';

const { entry } = useEntry();
const title = computed(() => String(entry.value?.content.title ?? 'Vulse site'));
const body = computed(() => entry.value?.content.body ?? []);
</script>

<template>
  <article v-if="entry" class="site-card site-entry">
    <p class="site-eyebrow">Home</p>
    <h1>{{ title }}</h1>
    <EntryBody :value="body" />
  </article>
  <section v-else class="site-hero">
    <p class="site-eyebrow">Vulse</p>
    <h1>Content-driven Vue SSR, served by the Vulse runtime.</h1>
    <p>
      Create a <code>home</code> singleton or publish entries in a collection with a
      <code>slug</code> field to replace this default landing page.
    </p>
    <a class="site-button" href="/admin">Open admin</a>
  </section>
</template>
