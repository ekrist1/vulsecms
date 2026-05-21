<script setup lang="ts">
import { useCollection } from '@vulse/site/composables';
import { definePageMeta } from '@vulse/site/page-meta';
import { computed } from 'vue';

definePageMeta({ layout: 'marketing' });

const { entries } = useCollection('posts');
const posts = computed(() => entries.value);

function title(entry: { content: Record<string, unknown> }) {
  return String(entry.content.title ?? entry.content.headline ?? 'Untitled');
}

function excerpt(entry: { content: Record<string, unknown> }) {
  const value = entry.content.excerpt ?? entry.content.description;
  return typeof value === 'string' ? value : '';
}

function href(entry: { id: string; content: Record<string, unknown> }) {
  const slug = typeof entry.content.slug === 'string' ? entry.content.slug : entry.id;
  return `/posts/${slug}`;
}
</script>

<template>
  <section class="post-index">
    <p class="eyebrow">Posts</p>
    <h1>Published writing from Vulse</h1>
    <div v-if="posts.length > 0" class="post-grid">
      <a v-for="entry in posts" :key="entry.id" class="post-card" :href="href(entry)">
        <span>{{ title(entry) }}</span>
        <small v-if="excerpt(entry)">{{ excerpt(entry) }}</small>
      </a>
    </div>
    <p v-else class="empty">No published posts yet.</p>
  </section>
</template>

<style scoped>
.post-index {
  display: grid;
  gap: 1.5rem;
}

.eyebrow {
  margin: 0;
  color: #5d6d4f;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

h1 {
  max-width: 12ch;
  margin: 0;
  font-size: clamp(3.5rem, 9vw, 7rem);
  line-height: 0.9;
  letter-spacing: -0.08em;
}

.post-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.post-card {
  display: grid;
  gap: 0.75rem;
  min-height: 10rem;
  padding: 1.25rem;
  border: 1px solid rgb(31 39 32 / 0.12);
  border-radius: 1.25rem;
  background: rgb(255 255 255 / 0.58);
  box-shadow: 0 1rem 3rem rgb(31 39 32 / 0.08);
  color: inherit;
  text-decoration: none;
}

.post-card span {
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.post-card small,
.empty {
  color: rgb(31 39 32 / 0.66);
  line-height: 1.6;
}
</style>
