<script setup lang="ts">
import { computed } from 'vue';
import type { NestedFieldDefinition, ReplicatorSetDefinition } from '../../api/client.js';
import FieldRenderer from '../FieldRenderer.vue';

interface ReplicatorItem {
  set: string;
  content: Record<string, unknown>;
}

const props = defineProps<{
  name: string;
  modelValue: unknown;
  sets?: ReplicatorSetDefinition[];
  error?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [ReplicatorItem[]] }>();

const items = computed<ReplicatorItem[]>(() =>
  Array.isArray(props.modelValue) ? (props.modelValue as ReplicatorItem[]) : [],
);
const setMap = computed(() => new Map((props.sets ?? []).map((set) => [set.name, set])));

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function labelForSet(set: ReplicatorSetDefinition): string {
  return set.label?.trim() || humanize(set.name);
}

function currentLocalDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultForField(field: NestedFieldDefinition): unknown {
  if (field.default !== undefined) return field.default;
  switch (field.ui.kind) {
    case 'boolean':
      return false;
    case 'blocks':
      return { type: 'doc', content: [{ type: 'paragraph' }] };
    case 'date':
      return currentLocalDatetime();
    default:
      return '';
  }
}

function emitItems(next: ReplicatorItem[]) {
  emit('update:modelValue', next);
}

function addSet(set: ReplicatorSetDefinition) {
  const content: Record<string, unknown> = {};
  for (const field of set.fields) {
    content[field.name] = defaultForField(field);
  }
  emitItems([...items.value, { set: set.name, content }]);
}

function removeItem(index: number) {
  emitItems(items.value.filter((_, current) => current !== index));
}

function moveItem(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.value.length) return;
  const next = [...items.value];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  emitItems(next);
}

function updateField(index: number, fieldName: string, value: unknown) {
  const next = [...items.value];
  const current = next[index];
  if (!current) return;
  next[index] = {
    ...current,
    content: {
      ...current.content,
      [fieldName]: value,
    },
  };
  emitItems(next);
}
</script>

<template>
  <div :data-testid="`field-${name}`" class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="set in sets ?? []"
          :key="set.name"
          type="button"
          class="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          :data-testid="`replicator-add-${set.name}`"
          @click="addSet(set)"
        >
          + {{ labelForSet(set) }}
        </button>
      </div>
    </div>

    <div
      v-if="items.length === 0"
      class="rounded border border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-sm text-zinc-500"
    >
      No sets added yet.
    </div>

    <div
      v-for="(item, index) in items"
      :key="`${item.set}-${index}`"
      class="rounded-xl border border-zinc-200 bg-white"
      :data-testid="`replicator-item-${index}`"
    >
      <div class="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <button type="button" class="px-2 text-zinc-400 hover:text-zinc-700" @click="moveItem(index, -1)">↑</button>
        <button type="button" class="px-2 text-zinc-400 hover:text-zinc-700" @click="moveItem(index, 1)">↓</button>
        <div class="flex-1">
          <span class="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
            {{ setMap.get(item.set) ? labelForSet(setMap.get(item.set)!) : item.set }}
          </span>
        </div>
        <button
          type="button"
          class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          :data-testid="`replicator-remove-${index}`"
          @click="removeItem(index)"
        >
          Remove
        </button>
      </div>

      <div v-if="setMap.get(item.set)" class="space-y-4 p-3">
        <component
          :is="FieldRenderer"
          v-for="field in setMap.get(item.set)!.fields"
          :key="`${item.set}-${field.name}`"
          :meta="field"
          :model-value="item.content?.[field.name]"
          @update:model-value="(value: unknown) => updateField(index, field.name, value)"
        />
      </div>
      <div v-else class="p-3 text-sm text-amber-700">
        This set no longer exists in the schema. It is preserved in the entry value until removed.
      </div>
    </div>

    <span v-if="error" class="block text-xs text-red-600">{{ error }}</span>
  </div>
</template>
