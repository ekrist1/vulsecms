<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../api/client.js';
import { useSetsStore } from '../stores/sets.js';
import { useToastsStore } from '../stores/toasts.js';

const setsStore = useSetsStore();
const toasts = useToastsStore();

async function load() {
  await setsStore.refresh();
}

async function destroy(handle: string) {
  if (!confirm(`Delete set "${handle}"?`)) return;
  await api.deleteSet(handle);
  toasts.success('Set deleted');
  await load();
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Sets</h1>
      <RouterLink to="/settings/sets/new" class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">+ New set</RouterLink>
    </div>
    <div v-if="setsStore.list.length === 0" class="text-sm text-zinc-500">
      No sets yet. Create one to make custom blocks available inside Bard editors.
    </div>
    <table v-else class="w-full text-left text-sm">
      <thead><tr class="border-b border-zinc-200 text-xs uppercase text-zinc-500">
        <th class="py-2">Handle</th><th>Label</th><th>Fields</th><th></th>
      </tr></thead>
      <tbody>
        <tr v-for="s in setsStore.list" :key="s.handle" class="border-b border-zinc-100">
          <td class="py-2 font-mono">{{ s.handle }}</td>
          <td>{{ s.label }}</td>
          <td>{{ s.fields.length }}</td>
          <td class="text-right">
            <RouterLink :to="`/settings/sets/${s.handle}`" class="mr-2 text-xs text-zinc-600 hover:text-zinc-900" :data-testid="`set-edit-${s.handle}`">Edit</RouterLink>
            <button class="text-xs text-red-600 hover:text-red-800" :data-testid="`set-delete-${s.handle}`" @click="destroy(s.handle)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
