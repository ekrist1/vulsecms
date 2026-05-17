<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type UserDTO } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';

const toasts = useToastsStore();
const users = ref<UserDTO[]>([]);
const total = ref(0);
const loading = ref(false);
const roleFilter = ref<string>('');

async function load() {
  loading.value = true;
  try {
    const res = await api.listUsers(roleFilter.value ? { role: roleFilter.value } : {});
    users.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

async function destroy(u: UserDTO) {
  if (!confirm(`Delete user ${u.email}?`)) return;
  await api.deleteUser(u.id);
  toasts.success('User deleted');
  await load();
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Users</h1>
      <RouterLink to="/settings/users/new" class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">
        + New user
      </RouterLink>
    </div>
    <div class="mb-3">
      <select v-model="roleFilter" class="rounded border border-zinc-300 px-3 py-1.5 text-sm" @change="load">
        <option value="">All roles</option>
        <option value="editor">Editors</option>
        <option value="external_user">External users</option>
      </select>
    </div>
    <table class="w-full text-left text-sm">
      <thead><tr class="border-b border-zinc-200 text-xs uppercase text-zinc-500">
        <th class="py-2">Email</th><th>Role</th><th>Super</th><th></th>
      </tr></thead>
      <tbody>
        <tr v-for="u in users" :key="u.id" class="border-b border-zinc-100">
          <td class="py-2 font-mono">{{ u.email }}</td>
          <td>{{ u.role }}</td>
          <td>{{ u.isSuper ? '✓' : '' }}</td>
          <td class="text-right">
            <RouterLink :to="`/settings/users/${u.id}`" class="mr-2 text-xs text-zinc-600 hover:text-zinc-900">Edit</RouterLink>
            <button class="text-xs text-red-600 hover:text-red-800" @click="destroy(u)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
