<script setup lang="ts">
import { computed, inject, type Component } from 'vue';
import type { BlockComponentMap, BlockNode } from './types.js';
import { COMPONENTS_KEY } from './inject.js';

const props = defineProps<{
  node: BlockNode;
}>();

const components = inject<BlockComponentMap>(COMPONENTS_KEY, {});

const resolved = computed<Component | null>(
  () => components[props.node.type] ?? null,
);
</script>

<template>
  <component
    v-if="resolved"
    :is="resolved"
    :node="node"
  />
</template>
