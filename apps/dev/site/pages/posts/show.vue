<script setup lang="ts">
import { type BlockNode, BlockRenderer } from '@vulse/renderer';
import { useEntry } from '@vulse/site/composables';
import { definePageMeta } from '@vulse/site/page-meta';
import { computed } from 'vue';

definePageMeta({ layout: 'marketing' });

const { entry } = useEntry();
const title = computed(() =>
  String(entry.value?.content.title ?? entry.value?.content.headline ?? 'Untitled'),
);
const excerpt = computed(() => {
  const value = entry.value?.content.excerpt ?? entry.value?.content.description;
  return typeof value === 'string' ? value : '';
});

function isBlockNode(value: unknown): value is BlockNode {
  return typeof value === 'object' && value !== null && 'type' in value;
}

const body = computed(() => {
  const value = entry.value?.content.body;
  if (Array.isArray(value)) return value.filter(isBlockNode);
  return isBlockNode(value) ? [value] : [];
});
</script>

<template>
  <article v-if="entry" class="post-detail">
    <a class="back-link" href="/posts">All posts</a>
    <p class="eyebrow">{{ entry.collection }}</p>
    <h1>{{ title }}</h1>
    <p v-if="excerpt" class="lead">{{ excerpt }}</p>
    <BlockRenderer v-if="body.length > 0" :doc="body" />
  </article>
  <section v-else class="post-detail">
    <p class="eyebrow">404</p>
    <h1>Post not found</h1>
  </section>
</template>

<style scoped>
.post-detail {
  max-width: 46rem;
}

.back-link {
  display: inline-flex;
  margin-bottom: 2rem;
  color: inherit;
  font-weight: 800;
  text-decoration: none;
}

.eyebrow {
  margin: 0 0 0.8rem;
  color: #5d6d4f;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(3.25rem, 8vw, 6.5rem);
  line-height: 0.9;
  letter-spacing: -0.08em;
}

.lead {
  margin: 1.5rem 0 2.5rem;
  color: rgb(31 39 32 / 0.72);
  font-size: 1.2rem;
  line-height: 1.7;
}
</style>
