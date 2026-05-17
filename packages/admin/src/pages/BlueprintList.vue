<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { type BlueprintMeta, api } from '../api/client.js';

const blueprints = ref<BlueprintMeta[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    blueprints.value = await api.listBlueprints();
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-6" data-testid="blueprint-list">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Schema</h1>
      <RouterLink
        to="/schema/new"
        class="vulse-button-primary rounded px-3 py-1.5 text-sm font-medium"
        data-testid="new-blueprint"
      >
        + New collection
      </RouterLink>
    </div>
    <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th class="py-2">Handle</th>
          <th class="py-2">Label</th>
          <th class="py-2">Fields</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="bp in blueprints" :key="bp.handle" class="border-b border-zinc-100">
          <td class="py-2 font-mono text-xs">
            <RouterLink :to="`/schema/${bp.handle}`" class="hover:underline">
              {{ bp.handle }}
            </RouterLink>
          </td>
          <td class="py-2">{{ bp.label }}</td>
          <td class="py-2 text-zinc-500">{{ bp.fields.length }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
