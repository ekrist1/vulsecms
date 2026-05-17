<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { type Entry, api } from '../../api/client.js';

const props = defineProps<{
  name: string;
  modelValue: string | undefined;
  to?: string;
}>();
defineEmits<{ 'update:modelValue': [string] }>();

const options = ref<Entry[]>([]);
const loading = ref(false);

onMounted(async () => {
  if (!props.to) return;
  loading.value = true;
  try {
    options.value = await api.listAll(props.to);
  } finally {
    loading.value = false;
  }
});

function labelFor(e: Entry): string {
  const c = e.content as Record<string, unknown>;
  return (c.title ?? c.name ?? e.id) as string;
}
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <select
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
      :value="modelValue ?? ''"
      :disabled="loading"
      :data-testid="`field-${name}`"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="" disabled>{{ loading ? 'Loading…' : `Select a ${to ?? 'related entry'}` }}</option>
      <option v-for="o in options" :key="o.id" :value="o.id">{{ labelFor(o) }}</option>
    </select>
  </label>
</template>
