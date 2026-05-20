<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { type FieldMeta, api } from '../api/client.js';
import FieldRenderer from '../components/FieldRenderer.vue';
import { useToastsStore } from '../stores/toasts.js';

const props = defineProps<{ handle: string | null }>();
const router = useRouter();
const toasts = useToastsStore();

const handle = ref('');
const label = ref('');
const fields = reactive<FieldMeta[]>([]);
const state = reactive<Record<string, unknown>>({});
const errors = reactive<Record<string, string>>({});
const savingDefinition = ref(false);
const savingValue = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
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

function defaultFor(kind: string): unknown {
  if (kind === 'boolean') return false;
  if (kind === 'blocks') return { type: 'doc', content: [{ type: 'paragraph' }] };
  if (kind === 'date') return currentLocalDatetime();
  return '';
}

function currentLocalDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ensureStateFields() {
  for (const field of fields) {
    if (!(field.name in state)) state[field.name] = field.default ?? defaultFor(field.ui.kind);
  }
}

watch(label, (value) => {
  if (isCreate.value && !handleLocked.value) handle.value = slugify(value);
});

function onHandleInput(event: Event) {
  handleLocked.value = true;
  handle.value = (event.target as HTMLInputElement).value;
}

async function load() {
  for (const key of Object.keys(state)) delete state[key];
  if (props.handle === null) {
    handleLocked.value = false;
    return;
  }

  loading.value = true;
  try {
    const result = await api.getGlobalSet(props.handle);
    handle.value = result.set.handle;
    label.value = result.set.label;
    fields.splice(0, fields.length, ...result.set.fields);
    handleLocked.value = true;
    ensureStateFields();
    Object.assign(state, result.value?.content ?? {});
  } finally {
    loading.value = false;
  }
}

function addField() {
  fields.push({ name: '', ui: { kind: 'text' }, optional: false });
}

function removeField(index: number) {
  const [field] = fields.splice(index, 1);
  if (field?.name) delete state[field.name];
}

function updateFieldName(index: number, event: Event) {
  const field = fields[index];
  if (!field) return;
  const oldName = field.name;
  const newName = (event.target as HTMLInputElement).value;
  field.name = newName;
  if (oldName && oldName in state && !(newName in state)) {
    state[newName] = state[oldName];
    delete state[oldName];
  }
}

function updateValue(name: string, value: unknown) {
  state[name] = value;
}

async function saveDefinition() {
  savingDefinition.value = true;
  error.value = null;
  try {
    const body = { handle: handle.value, label: label.value, fields: [...fields] };
    if (isCreate.value) {
      await api.createGlobalSet(body);
      toasts.success('Global set created');
      router.replace(`/settings/globals/${handle.value}`);
    } else {
      await api.updateGlobalSet(props.handle!, body);
      toasts.success('Global set saved');
    }
    ensureStateFields();
  } catch (err) {
    error.value = (err as { response?: { message?: string } }).response?.message ?? 'Save failed';
  } finally {
    savingDefinition.value = false;
  }
}

async function saveValue() {
  if (isCreate.value) return;
  for (const key of Object.keys(errors)) delete errors[key];
  savingValue.value = true;
  error.value = null;
  try {
    await api.updateGlobalValue(props.handle!, { ...state });
    toasts.success('Globals saved');
  } catch (err) {
    const response = (
      err as {
        response?: {
          error?: string;
          issues?: { path: unknown[]; message: string }[];
          message?: string;
        };
      }
    ).response;
    if (response?.error === 'validation' && response.issues) {
      for (const issue of response.issues) {
        const field = String(issue.path[0] ?? '');
        if (field) errors[field] = issue.message;
      }
    } else {
      error.value = response?.message ?? 'Save failed';
    }
  } finally {
    savingValue.value = false;
  }
}

async function destroy() {
  if (!props.handle) return;
  if (!confirm(`Delete global set "${props.handle}"?`)) return;
  await api.deleteGlobalSet(props.handle);
  toasts.success('Global set deleted');
  router.push('/settings/globals');
}

onMounted(load);
watch(() => props.handle, load);
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold">{{ isCreate ? 'New global set' : `Edit ${handle}` }}</h1>
        <p class="mt-1 text-sm text-zinc-500">
          Globals are site-wide content available to the frontend on every request.
        </p>
      </div>
      <button
        v-if="!isCreate"
        class="rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        data-testid="global-delete"
        @click="destroy"
      >
        Delete
      </button>
    </div>

    <div v-if="loading" class="text-sm text-zinc-500">Loading...</div>
    <div v-else class="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section class="space-y-4 rounded border border-zinc-200 bg-white p-4">
        <div>
          <h2 class="text-sm font-semibold text-zinc-700">Definition</h2>
          <p class="mt-1 text-xs text-zinc-500">
            Define the fields editors can fill in for this global set.
          </p>
        </div>

        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Label</span>
          <input
            v-model="label"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            data-testid="global-label"
          />
        </label>

        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Handle</span>
          <input
            :value="handle"
            :disabled="!isCreate"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm disabled:bg-zinc-100"
            data-testid="global-handle"
            @input="onHandleInput"
          />
        </label>

        <div>
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-zinc-700">Fields</h3>
            <button
              class="rounded border border-zinc-300 px-2 py-1 text-xs"
              data-testid="global-add-field"
              @click="addField"
            >
              + Add field
            </button>
          </div>
          <div v-for="(field, index) in fields" :key="index" class="mb-3 rounded border border-zinc-100 p-3">
            <div class="flex items-center gap-2">
              <input
                :value="field.name"
                class="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
                placeholder="name"
                :data-testid="`global-field-name-${index}`"
                @input="updateFieldName(index, $event)"
              />
              <select
                v-model="field.ui.kind"
                class="rounded border border-zinc-300 px-2 py-1 text-sm"
                :data-testid="`global-field-kind-${index}`"
              >
                <option value="text">text</option>
                <option value="textarea">textarea</option>
                <option value="blocks">blocks</option>
                <option value="date">date</option>
                <option value="boolean">boolean</option>
                <option value="asset">asset</option>
              </select>
              <label class="flex items-center gap-1 text-xs">
                <input v-model="field.optional" type="checkbox" />
                optional
              </label>
              <button class="text-xs text-red-600" @click="removeField(index)">Remove</button>
            </div>
          </div>
        </div>

        <button
          class="vulse-button-primary rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          :disabled="savingDefinition"
          data-testid="global-save-definition"
          @click="saveDefinition"
        >
          {{ savingDefinition ? 'Saving...' : (isCreate ? 'Create global set' : 'Save definition') }}
        </button>
      </section>

      <section class="space-y-4 rounded border border-zinc-200 bg-white p-4" :class="{ 'opacity-50': isCreate }">
        <div>
          <h2 class="text-sm font-semibold text-zinc-700">Content</h2>
          <p class="mt-1 text-xs text-zinc-500">
            This content is serialized into every built-in frontend render.
          </p>
        </div>

        <div v-if="isCreate" class="rounded bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
          Create the global set before editing content.
        </div>
        <template v-else>
          <FieldRenderer
            v-for="field in fields"
            :key="field.name"
            :meta="field"
            :model-value="state[field.name]"
            :error="errors[field.name] ?? ''"
            @update:model-value="(value: unknown) => updateValue(field.name, value)"
          />
          <button
            class="vulse-button-primary rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
            :disabled="savingValue"
            data-testid="global-save-value"
            @click="saveValue"
          >
            {{ savingValue ? 'Saving...' : 'Save content' }}
          </button>
        </template>
      </section>
    </div>

    <div v-if="error" class="mt-4 max-w-3xl rounded bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </div>
  </div>
</template>
