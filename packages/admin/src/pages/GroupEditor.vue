<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type GroupDTO } from '../api/client.js';
import { useBlueprintsStore } from '../stores/blueprints.js';
import { useToastsStore } from '../stores/toasts.js';

const props = defineProps<{ handle: string | null }>();
const router = useRouter();
const toasts = useToastsStore();
const blueprints = useBlueprintsStore();

const isCreate = computed(() => props.handle === null);
const handle = ref('');
const label = ref('');
const saving = ref(false);

interface RowState { canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean; canPublish: boolean; }
const matrix = reactive<Record<string, RowState>>({});

function ensureMatrixRow(bpHandle: string) {
  if (!matrix[bpHandle]) {
    matrix[bpHandle] = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canPublish: false };
  }
}

async function load() {
  await blueprints.hydrate();
  for (const bp of blueprints.list) {
    ensureMatrixRow(bp.handle);
  }
  if (!props.handle) return;
  const g = await api.getGroup(props.handle);
  handle.value = g.handle;
  label.value = g.label;
  for (const p of g.permissions) {
    ensureMatrixRow(p.collectionHandle);
    matrix[p.collectionHandle] = { canRead: p.canRead, canCreate: p.canCreate, canUpdate: p.canUpdate, canDelete: p.canDelete, canPublish: p.canPublish };
  }
}

async function save() {
  saving.value = true;
  try {
    let g: GroupDTO;
    if (isCreate.value) {
      g = await api.createGroup({ handle: handle.value, label: label.value });
    } else {
      await api.updateGroup(props.handle!, { label: label.value });
      g = await api.getGroup(props.handle!);
    }
    const rows = Object.entries(matrix).map(([ch, r]) => ({
      collectionHandle: ch,
      canRead: r.canRead, canCreate: r.canCreate, canUpdate: r.canUpdate, canDelete: r.canDelete, canPublish: r.canPublish,
    }));
    await api.setGroupPermissions(g.handle, rows);
    toasts.success('Group saved');
    router.push('/settings/groups');
  } catch (e) {
    toasts.error((e as { response?: { message?: string } }).response?.message ?? 'Save failed');
  } finally {
    saving.value = false;
  }
}

async function destroy() {
  if (!props.handle) return;
  if (!confirm(`Delete group ${props.handle}?`)) return;
  await api.deleteGroup(props.handle);
  toasts.success('Group deleted');
  router.push('/settings/groups');
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <h1 class="mb-4 text-xl font-semibold">{{ isCreate ? 'New group' : `Edit ${handle}` }}</h1>
    <div class="max-w-3xl space-y-4">
      <div class="space-y-3 rounded border border-zinc-200 bg-white p-4">
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Handle</span>
          <input v-model="handle" :disabled="!isCreate" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100" />
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Label</span>
          <input v-model="label" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <div class="rounded border border-zinc-200 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold text-zinc-700">Permissions</h2>
        <table class="w-full text-left text-sm">
          <thead><tr class="border-b border-zinc-200 text-xs uppercase text-zinc-500">
            <th>Collection</th><th class="text-center">Read</th><th class="text-center">Create</th><th class="text-center">Update</th><th class="text-center">Delete</th><th class="text-center">Publish</th>
          </tr></thead>
          <tbody>
            <template v-for="bp in blueprints.list" :key="bp.handle">
              <tr v-if="matrix[bp.handle]" class="border-b border-zinc-100">
                <td class="py-2 font-mono">{{ bp.handle }}</td>
                <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle]!.canRead" :data-testid="`perm-${bp.handle}-canRead`" /></td>
                <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle]!.canCreate" :data-testid="`perm-${bp.handle}-canCreate`" /></td>
                <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle]!.canUpdate" :data-testid="`perm-${bp.handle}-canUpdate`" /></td>
                <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle]!.canDelete" :data-testid="`perm-${bp.handle}-canDelete`" /></td>
                <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle]!.canPublish" :data-testid="`perm-${bp.handle}-canPublish`" /></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div class="flex items-center gap-2">
        <button class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50" :disabled="saving" data-testid="group-save" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button v-if="!isCreate" class="ml-auto rounded border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50" data-testid="group-delete" @click="destroy">
          Delete
        </button>
      </div>
    </div>
  </div>
</template>
