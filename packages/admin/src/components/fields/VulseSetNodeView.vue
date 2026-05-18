<script setup lang="ts">
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3';

const props = defineProps<NodeViewProps>();
</script>

<template>
  <NodeViewWrapper class="vulse-set">
    <div data-testid="vulse-set-placeholder">
      <em>set: {{ props.node.attrs.set ?? '(unset)' }}</em>
    </div>
  </NodeViewWrapper>
</template>
