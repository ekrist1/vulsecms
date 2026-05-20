<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { type GlobalSetDTO, api } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';

const toasts = useToastsStore();
const globals = ref<GlobalSetDTO[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    globals.value = await api.listGlobalSets();
  } finally {
    loading.value = false;
  }
}

async function destroy(handle: string) {
  if (!confirm(`Delete global set "${handle}"?`)) return;
  await api.deleteGlobalSet(handle);
  toasts.success('Global set deleted');
  await load();
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold">Globals</h1>
        <p class="mt-1 text-sm text-zinc-500">
          Site-wide content available to every frontend render.
        </p>
      </div>
      <RouterLink
        to="/settings/globals/new"
        class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
      >
        + New global set
      </RouterLink>
    </div>

    <div v-if="loading" class="text-sm text-zinc-500">Loading...</div>
    <div v-else-if="globals.length === 0" class="rounded border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
      No global sets yet. Create one for footer copy, contact details, social links, or default SEO content.
    </div>
    <table v-else class="w-full text-left text-sm">
      <thead>
        <tr class="border-b border-zinc-200 text-xs uppercase text-zinc-500">
          <th class="py-2">Handle</th>
          <th>Label</th>
          <th>Fields</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in globals" :key="g.handle" class="border-b border-zinc-100">
          <td class="py-2 font-mono">{{ g.handle }}</td>
          <td>{{ g.label }}</td>
          <td>{{ g.fields.length }}</td>
          <td class="text-right">
            <RouterLink
              :to="`/settings/globals/${g.handle}`"
              class="mr-2 text-xs text-zinc-600 hover:text-zinc-900"
              :data-testid="`global-edit-${g.handle}`"
            >
              Edit
            </RouterLink>
            <button
              class="text-xs text-red-600 hover:text-red-800"
              :data-testid="`global-delete-${g.handle}`"
              @click="destroy(g.handle)"
            >
              Delete
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
