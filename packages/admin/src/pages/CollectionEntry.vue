<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { type ApiError, api } from '../api/client.js';
import FieldRenderer from '../components/FieldRenderer.vue';
import { useBlueprintsStore } from '../stores/blueprints.js';

const props = defineProps<{ handle: string; id: string | null }>();
const router = useRouter();
const store = useBlueprintsStore();

const state = reactive<Record<string, unknown>>({});
const errors = reactive<Record<string, string>>({});
const saving = ref(false);
const loading = ref(false);
const submitError = ref<string | null>(null);

const blueprint = computed(() => store.get(props.handle));

async function loadEntry() {
  for (const k of Object.keys(state)) delete state[k];
  for (const k of Object.keys(errors)) delete errors[k];

  const bp = blueprint.value;
  if (!bp) return;

  if (props.id) {
    loading.value = true;
    try {
      const entry = await api.get(props.handle, props.id);
      for (const f of bp.fields) state[f.name] = (entry.content as Record<string, unknown>)[f.name];
    } finally {
      loading.value = false;
    }
  } else {
    for (const f of bp.fields) state[f.name] = f.default ?? defaultFor(f.ui.kind);
  }
}

function defaultFor(kind: string): unknown {
  if (kind === 'boolean') return false;
  if (kind === 'blocks') return { type: 'doc', content: [{ type: 'paragraph' }] };
  return '';
}

onMounted(loadEntry);
watch(() => [props.handle, props.id, blueprint.value], loadEntry);

async function save() {
  for (const k of Object.keys(errors)) delete errors[k];
  submitError.value = null;
  saving.value = true;
  try {
    const entry = props.id
      ? await api.update(props.handle, props.id, { ...state })
      : await api.create(props.handle, { ...state });
    if (!props.id) router.replace(`/collections/${props.handle}/${entry.id}`);
  } catch (err) {
    const e = err as { response?: ApiError };
    if (e.response?.error === 'validation' && e.response.issues) {
      for (const issue of e.response.issues) {
        const field = String(issue.path[0] ?? '');
        if (field) errors[field] = issue.message;
      }
    } else {
      submitError.value = e.response?.message ?? 'Failed to save';
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="p-6" :data-testid="`collection-entry-${handle}`">
    <div v-if="!blueprint" class="text-sm text-zinc-500">Unknown collection.</div>
    <template v-else>
      <h1 class="mb-4 text-xl font-semibold">
        {{ id ? 'Edit' : 'New' }} {{ blueprint.label }}
      </h1>
      <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
      <form v-else class="max-w-2xl space-y-4" @submit.prevent="save">
        <FieldRenderer
          v-for="f in blueprint.fields"
          :key="f.name"
          :meta="f"
          :model-value="state[f.name]"
          :error="errors[f.name] ?? ''"
          @update:model-value="(v: unknown) => (state[f.name] = v)"
        />
        <div v-if="submitError" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ submitError }}</div>
        <div class="flex gap-2">
          <button
            type="submit"
            class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            :disabled="saving"
            data-testid="submit"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>
