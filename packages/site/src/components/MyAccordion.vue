<!-- MyAccordion.vue -->
<script setup lang="ts">
import { type BlockNode, Node as RendererNode } from '@vulse/renderer';
import { computed } from 'vue';

const props = defineProps<{ node: BlockNode }>();
const summary = computed(() => {
  const s = String(props.node.attrs?.summary ?? 'Accordion');
  return s.charAt(0).toUpperCase() + s.slice(1);
});
const open = computed(() => Boolean(props.node.attrs?.open));
</script>

<template>
  <details class="site-accordion" data-site-accordion :open="open || undefined">
    <summary class="site-accordion__summary">{{ summary }}</summary>
    <RendererNode v-for="(child, i) in node.content ?? []" :key="i" :node="child" />
  </details>
</template>

<style scoped>
.site-accordion {
  margin: 1rem 0;
  border: 1px solid rgba(160, 79, 38, 0.24);
  border-radius: 1rem;
  background: rgba(160, 79, 38, 0.1);
  padding: 1rem;
}

.site-accordion__summary {
  cursor: pointer;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>