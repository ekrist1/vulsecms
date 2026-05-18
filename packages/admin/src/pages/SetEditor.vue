<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, type SetFieldDef } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';

const props = defineProps<{ handle: string | null }>();
const router = useRouter();
const toasts = useToastsStore();

const handle = ref('');
const label = ref('');
const fields = reactive<SetFieldDef[]>([]);
const saving = ref(false);
const error = ref<string | null>(null);
// When `false`, the handle auto-syncs from the slugified label. Flipped to
// `true` the moment the user types into the handle field directly, or on
// load of an existing set (handle is immutable on edit).
const handleLocked = ref(false);

const isCreate = computed(() => props.handle === null);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '');
}

watch(label, (v) => {
  if (isCreate.value && !handleLocked.value) {
    handle.value = slugify(v);
  }
});

function onHandleInput(event: Event) {
  handleLocked.value = true;
  handle.value = (event.target as HTMLInputElement).value;
}

async function load() {
  if (props.handle === null) {
    handleLocked.value = false;
    return;
  }
  const s = await api.getSet(props.handle);
  handle.value = s.handle;
  label.value = s.label;
  handleLocked.value = true;
  fields.splice(0, fields.length, ...s.fields);
}

function addField() {
  fields.push({ name: '', ui: { kind: 'text' }, optional: false });
}

function removeField(i: number) {
  fields.splice(i, 1);
}

async function save() {
  saving.value = true;
  error.value = null;
  try {
    const body = { handle: handle.value, label: label.value, fields: [...fields] };
    if (isCreate.value) await api.createSet(body);
    else await api.updateSet(props.handle!, body);
    toasts.success('Set saved');
    router.push('/settings/sets');
  } catch (e) {
    error.value = (e as { response?: { message?: string } }).response?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function destroy() {
  if (!props.handle) return;
  if (!confirm(`Delete set "${props.handle}"?`)) return;
  await api.deleteSet(props.handle);
  toasts.success('Set deleted');
  router.push('/settings/sets');
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <h1 class="mb-4 text-xl font-semibold">{{ isCreate ? 'New set' : `Edit ${handle}` }}</h1>
    <div class="max-w-3xl space-y-4">
      <div class="space-y-3 rounded border border-zinc-200 bg-white p-4">
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Label</span>
          <input v-model="label" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" data-testid="set-label" />
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Handle</span>
          <input
            :value="handle"
            :disabled="!isCreate"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100"
            data-testid="set-handle"
            @input="onHandleInput"
          />
          <span v-if="isCreate" class="mt-1 block text-xs text-zinc-500">
            Auto-generated from the label until you edit it.
          </span>
        </label>
      </div>

      <div class="rounded border border-zinc-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-zinc-700">Fields</h2>
          <button class="rounded border border-zinc-300 px-2 py-1 text-xs" data-testid="set-add-field" @click="addField">+ Add field</button>
        </div>
        <div v-for="(f, i) in fields" :key="i" class="mb-3 rounded border border-zinc-100 p-3">
          <div class="flex items-center justify-between gap-2">
            <input v-model="f.name" class="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm" placeholder="name" :data-testid="`set-field-name-${i}`" />
            <select v-model="f.ui.kind" class="rounded border border-zinc-300 px-2 py-1 text-sm" :data-testid="`set-field-kind-${i}`">
              <option value="text">text</option>
              <option value="textarea">textarea</option>
              <option value="blocks">blocks</option>
              <option value="date">date</option>
              <option value="boolean">boolean</option>
              <option value="select">select</option>
              <option value="relationship">relationship</option>
              <option value="asset">asset</option>
            </select>
            <label class="flex items-center gap-1 text-xs">
              <input type="checkbox" v-model="f.optional" /> optional
            </label>
            <button class="text-xs text-red-600" @click="removeField(i)">Remove</button>
          </div>
        </div>
      </div>

      <div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>
      <div class="flex items-center gap-2">
        <button class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50" :disabled="saving" data-testid="set-save" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button v-if="!isCreate" class="ml-auto rounded border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50" data-testid="set-delete" @click="destroy">
          Delete
        </button>
      </div>
    </div>
  </div>
</template>
