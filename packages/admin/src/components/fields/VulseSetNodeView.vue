<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/vue-3';
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, ref } from 'vue';
import type { FieldMeta } from '../../api/client.js';
import { useSetsStore } from '../../stores/sets.js';
import FieldRenderer from '../FieldRenderer.vue';

const props = defineProps<NodeViewProps>();

const store = useSetsStore();
const expanded = ref(false);

const setHandle = computed<string | null>(() => {
  const s = (props.node.attrs as { set?: unknown }).set;
  return typeof s === 'string' ? s : null;
});

const setDef = computed(() => (setHandle.value ? store.get(setHandle.value) : undefined));

const data = computed<Record<string, unknown>>(() => {
  return (
    ((props.node.attrs as { data?: unknown }).data as Record<string, unknown> | undefined) ?? {}
  );
});

function updateField(name: string, value: unknown) {
  const next = { ...data.value, [name]: value };
  props.updateAttributes({ data: next });
}

function toggle() {
  expanded.value = !expanded.value;
}

const summary = computed(() => {
  const def = setDef.value;
  if (!def) return '';
  const firstText = def.fields.find((f) => f.ui.kind === 'text' || f.ui.kind === 'textarea');
  if (!firstText) return '';
  const v = data.value[firstText.name];
  return typeof v === 'string' && v ? v.slice(0, 80) : '';
});
</script>

<template>
  <NodeViewWrapper class="vulse-set my-2">
    <div
      v-if="!setDef"
      class="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
      data-testid="vulse-set-missing"
    >
      <div class="font-medium">Missing set: {{ setHandle ?? '(unset)' }}</div>
      <button
        type="button"
        class="mt-1 text-xs text-amber-900 underline"
        data-testid="vulse-set-remove"
        @click="deleteNode"
      >
        Remove
      </button>
    </div>
    <div
      v-else
      class="rounded border border-zinc-200 bg-white"
    >
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          class="flex flex-1 items-center gap-2 text-left text-sm"
          data-testid="vulse-set-toggle"
          @click="toggle"
        >
          <span class="text-zinc-400">{{ expanded ? '▾' : '▸' }}</span>
          <span class="font-medium text-zinc-800">{{ setDef.label }}</span>
          <span v-if="!expanded && summary" class="truncate text-zinc-500">— {{ summary }}</span>
        </button>
        <button
          type="button"
          class="text-xs text-zinc-500 hover:text-red-700"
          data-testid="vulse-set-remove"
          @click="deleteNode"
        >
          Remove
        </button>
      </div>
      <div v-if="expanded" class="space-y-2 border-t border-zinc-200 p-3" data-testid="vulse-set-form">
        <FieldRenderer
          v-for="f in setDef.fields"
          :key="f.name"
          :meta="(f as unknown as FieldMeta)"
          :model-value="data[f.name]"
          :error="''"
          @update:model-value="(v: unknown) => updateField(f.name, v)"
        />
      </div>
    </div>
  </NodeViewWrapper>
</template>
