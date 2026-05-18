<script setup lang="ts">
import { type BlockNode, BlockRenderer } from '@vulse/renderer';
import { computed } from 'vue';

const props = defineProps<{
  value: unknown;
}>();

function isBlockNode(value: unknown): value is BlockNode {
  return typeof value === 'object' && value !== null && 'type' in value;
}

const doc = computed<BlockNode | BlockNode[]>(() => {
  if (Array.isArray(props.value)) return props.value.filter(isBlockNode);
  if (isBlockNode(props.value)) return props.value;
  return [];
});
</script>

<template>
  <BlockRenderer v-if="Array.isArray(doc) ? doc.length > 0 : true" :doc="doc" />
</template>
