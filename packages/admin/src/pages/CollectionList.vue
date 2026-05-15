<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type Entry } from '../api/client.js';
import { useBlueprintsStore } from '../stores/blueprints.js';

const props = defineProps<{ handle: string }>();
const entries = ref<Entry[]>([]);
const loading = ref(false);
const store = useBlueprintsStore();

async function load(handle: string) {
  loading.value = true;
  try {
    entries.value = await api.list(handle);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(props.handle));
watch(() => props.handle, (h) => load(h));

function preview(e: Entry): string {
  const c = e.content as Record<string, unknown>;
  return (c.title ?? c.name ?? e.id) as string;
}

async function remove(id: string) {
  if (!confirm('Delete this entry?')) return;
  await api.delete(props.handle, id);
  entries.value = entries.value.filter((e) => e.id !== id);
}
</script>

<template>
  <div class="p-6" :data-testid="`collection-list-${handle}`">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold capitalize">{{ store.get(handle)?.label ?? handle }}</h1>
      <RouterLink
        :to="`/collections/${handle}/new`"
        class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        data-testid="new-entry"
      >
        New entry
      </RouterLink>
    </div>

    <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
    <div v-else-if="entries.length === 0" class="rounded border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
      No entries yet.
    </div>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th class="py-2">ID</th>
          <th class="py-2">Preview</th>
          <th class="py-2">Updated</th>
          <th class="py-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in entries" :key="e.id" class="border-b border-zinc-100">
          <td class="py-2 font-mono text-xs text-zinc-500">{{ e.id.slice(0, 8) }}…</td>
          <td class="py-2">
            <RouterLink :to="`/collections/${handle}/${e.id}`" class="hover:underline">
              {{ preview(e) }}
            </RouterLink>
          </td>
          <td class="py-2 text-zinc-500">{{ e.updatedAt }}</td>
          <td class="py-2 text-right">
            <button class="text-xs text-red-600 hover:underline" :data-testid="`delete-${e.id}`" @click="remove(e.id)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
