<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type GroupDTO } from '../api/client.js';
const groups = ref<GroupDTO[]>([]);
onMounted(async () => { groups.value = await api.listGroups(); });
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Groups</h1>
      <RouterLink to="/settings/groups/new" class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">+ New group</RouterLink>
    </div>
    <table class="w-full text-left text-sm">
      <thead><tr class="border-b border-zinc-200 text-xs uppercase text-zinc-500"><th class="py-2">Handle</th><th>Label</th><th></th></tr></thead>
      <tbody>
        <tr v-for="g in groups" :key="g.id" class="border-b border-zinc-100">
          <td class="py-2 font-mono">{{ g.handle }}</td>
          <td>{{ g.label }}</td>
          <td class="text-right">
            <RouterLink :to="`/settings/groups/${g.handle}`" class="text-xs text-zinc-600 hover:text-zinc-900">Edit</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
