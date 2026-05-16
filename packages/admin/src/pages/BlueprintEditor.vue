<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  type ApiError,
  type BlueprintMeta,
  type FieldDefinition,
  type FieldUi,
  api,
} from '../api/client.js';
import { useBlueprintsStore } from '../stores/blueprints.js';

const props = defineProps<{ handle: string | null }>();
const router = useRouter();
const store = useBlueprintsStore();

interface EditorField extends FieldDefinition {
  previousName: string | null; // null = newly added; otherwise tracks rename source
}

const handle = ref('');
const label = ref('');
const singleton = ref(false);
const fields = reactive<EditorField[]>([]);
const expandedIndex = ref<number | null>(null);

const errors = reactive<Record<string, string>>({});
const submitError = ref<string | null>(null);
const saving = ref(false);

const handleLocked = ref(false);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '');
}

function unlockHandle() {
  handleLocked.value = true;
}

function resetHandle() {
  handleLocked.value = false;
  handle.value = slugify(label.value);
}

const isCreate = computed(() => props.handle === null);

watch(label, (v) => {
  if (isCreate.value && !handleLocked.value) {
    handle.value = slugify(v);
  }
});

async function load() {
  for (const k of Object.keys(errors)) delete errors[k];
  fields.splice(0, fields.length);
  if (props.handle === null) {
    handle.value = '';
    label.value = '';
    singleton.value = false;
    handleLocked.value = false;
    return;
  }
  const bp = await api.getBlueprint(props.handle);
  handle.value = bp.handle;
  label.value = bp.label;
  singleton.value = bp.singleton;
  handleLocked.value = true;
  for (const f of bp.fields) {
    fields.push({ ...f, previousName: f.name });
  }
}

onMounted(load);
watch(() => props.handle, load);

function addField() {
  fields.push({
    name: '',
    label: '',
    ui: { kind: 'text' },
    optional: false,
    previousName: null,
  });
  expandedIndex.value = fields.length - 1;
}

function removeField(i: number) {
  fields.splice(i, 1);
  if (expandedIndex.value === i) expandedIndex.value = null;
}

function moveUp(i: number) {
  if (i === 0) return;
  const [moved] = fields.splice(i, 1);
  fields.splice(i - 1, 0, moved!);
  if (expandedIndex.value === i) expandedIndex.value = i - 1;
}

function moveDown(i: number) {
  if (i >= fields.length - 1) return;
  const [moved] = fields.splice(i, 1);
  fields.splice(i + 1, 0, moved!);
  if (expandedIndex.value === i) expandedIndex.value = i + 1;
}

function setKind(i: number, kind: FieldUi['kind']) {
  const f = fields[i]!;
  if (kind === 'select') f.ui = { kind, options: [] };
  else if (kind === 'relationship') f.ui = { kind, to: '' };
  else f.ui = { kind };
}

async function save() {
  for (const k of Object.keys(errors)) delete errors[k];
  submitError.value = null;
  saving.value = true;
  try {
    const payload = {
      handle: handle.value,
      label: label.value,
      singleton: singleton.value,
      fields: fields.map((f) => {
        const out: Record<string, unknown> = {
          name: f.name,
          label: f.label,
          ui: f.ui,
          optional: f.optional,
        };
        if (f.default !== undefined) out.default = f.default;
        if (f.validation) out.validation = f.validation;
        if (f.previousName !== null && f.previousName !== f.name) {
          out.previousName = f.previousName;
        }
        return out;
      }),
    };
    if (isCreate.value) {
      await api.createBlueprint(payload as unknown as BlueprintMeta);
    } else {
      await api.updateBlueprint(props.handle!, payload as never);
    }
    await store.refresh();
    router.push(`/schema/${handle.value}`);
  } catch (err) {
    const e = err as { response?: ApiError };
    if (e.response?.error === 'validation' && e.response.issues) {
      for (const issue of e.response.issues) {
        const key = issue.path.join('.');
        errors[key] = issue.message;
      }
      submitError.value = 'Some fields are invalid; see inline messages.';
    } else {
      submitError.value = e.response?.message ?? 'Failed to save';
    }
  } finally {
    saving.value = false;
  }
}

async function destroy() {
  if (!props.handle) return;
  if (!confirm(`Delete blueprint '${props.handle}' and ALL its entries?`)) return;
  await api.deleteBlueprint(props.handle);
  await store.refresh();
  router.push('/schema');
}
</script>

<template>
  <div class="p-6" data-testid="blueprint-editor">
    <h1 class="mb-4 text-xl font-semibold">{{ isCreate ? 'New collection' : `Edit ${handle}` }}</h1>

    <form class="max-w-3xl space-y-6" @submit.prevent="save">
      <div class="space-y-3 rounded border border-zinc-200 bg-white p-4">
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Label</span>
          <input
            v-model="label"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            data-testid="blueprint-label"
          />
          <span v-if="errors['label']" class="mt-1 block text-xs text-red-600">{{ errors['label'] }}</span>
        </label>
        <div>
          <div class="flex items-baseline justify-between">
            <span class="block text-sm font-medium text-zinc-700">Handle</span>
            <div v-if="isCreate" class="flex gap-3 text-xs">
              <button
                v-if="!handleLocked"
                type="button"
                class="text-zinc-500 hover:text-zinc-900"
                data-testid="handle-edit"
                @click="unlockHandle"
              >
                Edit
              </button>
              <button
                v-else
                type="button"
                class="text-zinc-500 hover:text-zinc-900"
                data-testid="handle-reset"
                @click="resetHandle"
              >
                Reset
              </button>
            </div>
          </div>
          <input
            v-model="handle"
            :readonly="!isCreate || !handleLocked"
            :disabled="!isCreate"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm read-only:bg-zinc-50 disabled:bg-zinc-100"
            data-testid="blueprint-handle"
          />
          <span v-if="errors['handle']" class="mt-1 block text-xs text-red-600">{{ errors['handle'] }}</span>
        </div>
        <label class="flex items-center gap-2">
          <input
            v-model="singleton"
            type="checkbox"
            class="rounded border-zinc-300"
            data-testid="blueprint-singleton"
          />
          <span class="text-sm font-medium text-zinc-700">Singleton (only one entry)</span>
        </label>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-zinc-700">Fields</h2>
          <button
            type="button"
            class="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            data-testid="add-field"
            @click="addField"
          >
            + Add field
          </button>
        </div>

        <div
          v-for="(f, i) in fields"
          :key="i"
          class="rounded border border-zinc-200 bg-white"
          :data-testid="`field-card-${f.name || `new-${i}`}`"
        >
          <div class="flex items-center gap-2 px-3 py-2">
            <button type="button" class="px-2 text-zinc-400 hover:text-zinc-700" :data-testid="`field-up-${i}`" @click="moveUp(i)">↑</button>
            <button type="button" class="px-2 text-zinc-400 hover:text-zinc-700" :data-testid="`field-down-${i}`" @click="moveDown(i)">↓</button>
            <div class="flex-1">
              <button
                type="button"
                class="text-left"
                :data-testid="`field-expand-${i}`"
                @click="expandedIndex = expandedIndex === i ? null : i"
              >
                <span class="font-mono text-sm">{{ f.name || '(new field)' }}</span>
                <span class="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{{ f.ui.kind }}</span>
                <span v-if="!f.optional" class="ml-1 rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">required</span>
              </button>
            </div>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              :data-testid="`field-remove-${i}`"
              @click="removeField(i)"
            >
              Remove
            </button>
          </div>

          <div v-if="expandedIndex === i" class="space-y-3 border-t border-zinc-200 px-3 py-3">
            <label class="block">
              <span class="block text-xs font-medium text-zinc-600">Name</span>
              <input
                v-model="f.name"
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                :data-testid="`field-name-${i}`"
              />
            </label>
            <label class="block">
              <span class="block text-xs font-medium text-zinc-600">Label</span>
              <input
                v-model="f.label"
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label class="block">
              <span class="block text-xs font-medium text-zinc-600">Kind</span>
              <select
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                :value="f.ui.kind"
                :data-testid="`field-kind-${i}`"
                @change="setKind(i, ($event.target as HTMLSelectElement).value as FieldUi['kind'])"
              >
                <option value="text">text</option>
                <option value="textarea">textarea</option>
                <option value="blocks">blocks</option>
                <option value="date">date</option>
                <option value="boolean">boolean</option>
                <option value="select">select</option>
                <option value="relationship">relationship</option>
              </select>
            </label>
            <label class="flex items-center gap-2">
              <input v-model="f.optional" type="checkbox" class="rounded border-zinc-300" :data-testid="`field-optional-${i}`" />
              <span class="text-xs font-medium text-zinc-600">Optional</span>
            </label>

            <!-- text/textarea: min/max -->
            <div v-if="f.ui.kind === 'text' || f.ui.kind === 'textarea'" class="flex gap-3">
              <label class="block flex-1">
                <span class="block text-xs font-medium text-zinc-600">Min length</span>
                <input
                  type="number"
                  :value="f.validation?.min ?? ''"
                  class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                  @input="
                    (function() {
                      const v = ($event.target as HTMLInputElement).value;
                      const next: { min?: number; max?: number } = {};
                      if (v !== '') next.min = Number(v);
                      if (f.validation?.max !== undefined) next.max = f.validation.max;
                      f.validation = next;
                    })()
                  "
                />
              </label>
              <label class="block flex-1">
                <span class="block text-xs font-medium text-zinc-600">Max length</span>
                <input
                  type="number"
                  :value="f.validation?.max ?? ''"
                  class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                  @input="
                    (function() {
                      const v = ($event.target as HTMLInputElement).value;
                      const next: { min?: number; max?: number } = {};
                      if (f.validation?.min !== undefined) next.min = f.validation.min;
                      if (v !== '') next.max = Number(v);
                      f.validation = next;
                    })()
                  "
                />
              </label>
            </div>

            <!-- select: options editor -->
            <div v-if="f.ui.kind === 'select'">
              <span class="block text-xs font-medium text-zinc-600">Options</span>
              <textarea
                rows="3"
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 font-mono text-xs"
                :value="(f.ui.options ?? []).join('\n')"
                :data-testid="`field-options-${i}`"
                @input="
                  f.ui = {
                    kind: 'select',
                    options: ($event.target as HTMLTextAreaElement).value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }
                "
              />
              <span class="text-xs text-zinc-500">One option per line.</span>
            </div>

            <!-- relationship: target picker -->
            <label v-if="f.ui.kind === 'relationship'" class="block">
              <span class="block text-xs font-medium text-zinc-600">Target collection</span>
              <select
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                :value="f.ui.to ?? ''"
                :data-testid="`field-to-${i}`"
                @change="f.ui = { kind: 'relationship', to: ($event.target as HTMLSelectElement).value }"
              >
                <option value="" disabled>Choose a collection</option>
                <option v-for="bp in store.list" :key="bp.handle" :value="bp.handle">{{ bp.handle }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div v-if="submitError" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ submitError }}
      </div>

      <div class="flex items-center gap-2">
        <button
          type="submit"
          class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          :disabled="saving"
          data-testid="blueprint-save"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <RouterLink
          to="/schema"
          class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          data-testid="blueprint-cancel"
        >
          Cancel
        </RouterLink>
        <button
          v-if="!isCreate"
          type="button"
          class="ml-auto rounded border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          data-testid="blueprint-delete"
          @click="destroy"
        >
          Delete
        </button>
      </div>
    </form>
  </div>
</template>
