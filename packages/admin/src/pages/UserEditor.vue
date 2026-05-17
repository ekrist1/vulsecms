<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type GroupDTO } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';

const props = defineProps<{ id: string | null }>();
const router = useRouter();
const toasts = useToastsStore();

const email = ref('');
const password = ref('');
const name = ref('');
const role = ref<'editor' | 'external_user'>('editor');
const isSuper = ref(false);
const groupIds = ref<string[]>([]);
const groups = ref<GroupDTO[]>([]);
const saving = ref(false);
const isCreate = ref(props.id === null);

async function load() {
  groups.value = await api.listGroups();
  if (props.id === null) return;
  const u = await api.getUser(props.id);
  email.value = u.email;
  name.value = u.name ?? '';
  role.value = u.role;
  isSuper.value = u.isSuper;
  groupIds.value = u.groupIds;
}

async function save() {
  saving.value = true;
  try {
    if (isCreate.value) {
      await api.createUser({ email: email.value, password: password.value, name: name.value, role: role.value, isSuper: isSuper.value, groupIds: groupIds.value });
    } else {
      await api.updateUser(props.id!, { name: name.value, role: role.value, isSuper: isSuper.value, groupIds: groupIds.value });
    }
    toasts.success('User saved');
    router.push('/settings/users');
  } catch (e) {
    toasts.error((e as { response?: { message?: string } }).response?.message ?? 'Save failed');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <h1 class="mb-4 text-xl font-semibold">{{ isCreate ? 'New user' : 'Edit user' }}</h1>
    <form class="max-w-xl space-y-3" @submit.prevent="save">
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Email</span>
        <input v-model="email" type="email" :disabled="!isCreate" required class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100" />
      </label>
      <label v-if="isCreate" class="block">
        <span class="block text-sm font-medium text-zinc-700">Password</span>
        <input v-model="password" type="password" required minlength="12" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Name</span>
        <input v-model="name" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Role</span>
        <select v-model="role" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm">
          <option value="editor">Editor</option>
          <option value="external_user">External user</option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        <input v-model="isSuper" type="checkbox" class="rounded border-zinc-300" />
        <span class="text-sm font-medium text-zinc-700">Super user (bypasses all permission checks)</span>
      </label>
      <div>
        <span class="block text-sm font-medium text-zinc-700">Groups</span>
        <div class="mt-1 space-y-1">
          <label v-for="g in groups" :key="g.id" class="flex items-center gap-2 text-sm">
            <input type="checkbox" :value="g.id" v-model="groupIds" />
            <span>{{ g.label }} <span class="text-xs text-zinc-500">({{ g.handle }})</span></span>
          </label>
        </div>
      </div>
      <button type="submit" class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50" :disabled="saving">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </form>
  </div>
</template>
