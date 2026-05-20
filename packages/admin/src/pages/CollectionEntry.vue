<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { type ApiError, type Entry, api } from '../api/client.js';
import EntryBreadcrumb from '../components/EntryBreadcrumb.vue';
import EntryStatusBadge from '../components/EntryStatusBadge.vue';
import FieldRenderer from '../components/FieldRenderer.vue';
import RevisionsPanel from '../components/RevisionsPanel.vue';
import { useAuthStore } from '../stores/auth.js';
import { useBlueprintsStore } from '../stores/blueprints.js';
import { useToastsStore } from '../stores/toasts.js';

const props = defineProps<{ handle: string; id: string | null }>();
const router = useRouter();
const route = useRoute();
const store = useBlueprintsStore();
const toasts = useToastsStore();
const auth = useAuthStore();

const state = reactive<Record<string, unknown>>({});
const errors = reactive<Record<string, string>>({});
const saving = ref(false);
const loading = ref(false);
const submitError = ref<string | null>(null);
const isProtected = ref(false);
const activeTab = ref<'edit' | 'revisions'>('edit');

// Tree-collection bits (only meaningful when blueprint.tree === true).
const parentId = ref<string | null>(null);
const originalParentId = ref<string | null>(null);
const candidates = ref<Entry[]>([]);
const ancestors = ref<Array<{ id: string; label: string }>>([]);
const children = ref<Entry[]>([]);

const blueprint = computed(() => store.get(props.handle));
const isTreeCollection = computed(() => blueprint.value?.tree === true);
const draftsEnabled = computed(() => blueprint.value?.drafts === true);
const canPublish = computed(
  () => auth.user?.isSuper === true || auth.perms?.[props.handle]?.includes('publish') === true,
);
const currentEntry = ref<Entry | null>(null);
const LAST_SAVE_KEY = 'vulse.editor.lastSaveAction';
const lastSaveAction = ref<'draft' | 'publish'>(
  typeof localStorage !== 'undefined' && localStorage.getItem(LAST_SAVE_KEY) === 'publish'
    ? 'publish'
    : 'draft',
);
function rememberAction(v: 'draft' | 'publish') {
  lastSaveAction.value = v;
  try {
    localStorage.setItem(LAST_SAVE_KEY, v);
  } catch {
    /* SSR */
  }
}

function entryLabel(entry: { id: string; content: Record<string, unknown> }): string {
  const c = entry.content;
  return (
    (c.title as string | undefined) ??
    (c.name as string | undefined) ??
    (c.label as string | undefined) ??
    entry.id
  );
}

// Slug auto-gen: when a blueprint has both `title` (text) and `slug` (text),
// derive the slug from the title until the user types directly into slug.
const slugTouched = ref(false);
const hasAutoSlug = computed(() => {
  const bp = blueprint.value;
  if (!bp) return false;
  const has = (name: string) => bp.fields.some((f) => f.name === name && f.ui.kind === 'text');
  return has('title') && has('slug');
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function loadEntry() {
  for (const k of Object.keys(state)) delete state[k];
  for (const k of Object.keys(errors)) delete errors[k];
  slugTouched.value = false;
  parentId.value = null;
  originalParentId.value = null;
  ancestors.value = [];
  children.value = [];

  const bp = blueprint.value;
  if (!bp) return;

  if (props.id) {
    loading.value = true;
    try {
      const entry = await api.get(props.handle, props.id);
      currentEntry.value = entry;
      const content = entry.draftContent ?? entry.content;
      for (const f of bp.fields) state[f.name] = (content as Record<string, unknown>)[f.name];
      isProtected.value = entry.protected ?? false;
      slugTouched.value = true; // existing entries: don't overwrite a saved slug
      if (bp.tree) {
        parentId.value = entry.parentId;
        originalParentId.value = entry.parentId;
        await Promise.all([loadTreeCandidates(), loadAncestors(entry), loadChildren(entry.id)]);
      }
    } finally {
      loading.value = false;
    }
  } else {
    for (const f of bp.fields) state[f.name] = f.default ?? defaultFor(f.ui.kind);
    isProtected.value = false;
    // For a new tree entry, allow query `?parent_id=<id>` to pre-fill the parent
    // (used by the "Add child" action on the parent's editor).
    if (bp.tree) {
      const qpid = route.query.parent_id;
      const pid = typeof qpid === 'string' && qpid !== '' ? qpid : null;
      parentId.value = pid;
      originalParentId.value = pid;
      await loadTreeCandidates();
      if (pid) {
        try {
          const parent = await api.get(props.handle, pid);
          await loadAncestors({ ...parent, parentId: parent.parentId });
          // Push the parent itself as the last "trail" item so the new entry
          // shows as nesting under it.
          ancestors.value = [...ancestors.value, { id: parent.id, label: entryLabel(parent) }];
        } catch {
          // ignore — parent lookup failure shouldn't block the editor
        }
      }
    }
  }
}

async function loadTreeCandidates() {
  // For the parent picker. Capped at 500 to match listAll's default.
  candidates.value = await api.listAll(props.handle, 500);
}

async function loadAncestors(entry: { parentId: string | null }) {
  const chain: Array<{ id: string; label: string }> = [];
  let cursor: string | null = entry.parentId;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    try {
      const parent = await api.get(props.handle, cursor);
      chain.unshift({ id: parent.id, label: entryLabel(parent) });
      cursor = parent.parentId;
    } catch {
      break;
    }
  }
  ancestors.value = chain;
}

async function loadChildren(id: string) {
  const result = await api.list(props.handle, { parentId: id, limit: 200 });
  children.value = result.items;
}

// Compute the set of descendant ids of the current entry — those can't be its
// new parent. Built from the candidates list (a flat fetch of the collection).
const descendantIds = computed<Set<string>>(() => {
  if (!props.id) return new Set();
  const byParent = new Map<string | null, Entry[]>();
  for (const e of candidates.value) {
    const bucket = byParent.get(e.parentId) ?? [];
    bucket.push(e);
    byParent.set(e.parentId, bucket);
  }
  const out = new Set<string>([props.id]);
  const queue: string[] = [props.id];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const child of byParent.get(next) ?? []) {
      if (!out.has(child.id)) {
        out.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return out;
});

// Indented list of valid parent candidates for the picker (excluding the
// entry itself and its descendants).
const parentOptions = computed<Array<{ id: string; label: string; depth: number }>>(() => {
  const byParent = new Map<string | null, Entry[]>();
  for (const e of candidates.value) {
    const bucket = byParent.get(e.parentId) ?? [];
    bucket.push(e);
    byParent.set(e.parentId, bucket);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  const out: Array<{ id: string; label: string; depth: number }> = [];
  function walk(parent: string | null, depth: number) {
    for (const entry of byParent.get(parent) ?? []) {
      if (descendantIds.value.has(entry.id)) continue;
      out.push({ id: entry.id, label: entryLabel(entry), depth });
      walk(entry.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
});

function defaultFor(kind: string): unknown {
  if (kind === 'boolean') return false;
  if (kind === 'blocks') return { type: 'doc', content: [{ type: 'paragraph' }] };
  if (kind === 'replicator') return [];
  if (kind === 'date') return currentLocalDatetime();
  return '';
}

function currentLocalDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateField(name: string, value: unknown) {
  state[name] = value;
  if (name === 'slug') slugTouched.value = true;
  if (name === 'title' && hasAutoSlug.value && !slugTouched.value && typeof value === 'string') {
    state.slug = slugify(value);
  }
}

onMounted(loadEntry);
watch(() => [props.handle, props.id, blueprint.value], loadEntry);

async function save(action: 'draft' | 'publish') {
  for (const k of Object.keys(errors)) delete errors[k];
  submitError.value = null;
  saving.value = true;
  const publish = draftsEnabled.value ? action === 'publish' : true;
  rememberAction(action);
  try {
    let entry: Entry;
    if (props.id) {
      entry = await api.update(
        props.handle,
        props.id,
        {
          ...state,
          protected: isProtected.value,
        },
        { publish },
      );
      // If the parent changed in the picker, apply the move after the content update.
      if (isTreeCollection.value && parentId.value !== originalParentId.value) {
        entry = await api.moveEntry(props.handle, props.id, { parentId: parentId.value });
        originalParentId.value = parentId.value;
      }
    } else {
      const payload: Record<string, unknown> = {
        ...state,
        protected: isProtected.value,
      };
      if (isTreeCollection.value && parentId.value !== null) {
        payload.parentId = parentId.value;
      }
      entry = await api.create(props.handle, payload, { publish });
    }
    currentEntry.value = entry;
    toasts.success(publish ? 'Entry published' : 'Draft saved');
    if (!props.id) router.replace(`/collections/${props.handle}/${entry.id}`);
  } catch (err) {
    const e = err as { response?: ApiError };
    if (e.response?.error === 'validation' && e.response.issues) {
      for (const issue of e.response.issues) {
        const field = String(issue.path[0] ?? '');
        if (field) errors[field] = issue.message;
      }
    } else {
      const msg = e.response?.message ?? 'Failed to save';
      submitError.value = msg;
      toasts.error(msg);
    }
  } finally {
    saving.value = false;
  }
}

async function publishNow() {
  if (!props.id) return;
  saving.value = true;
  try {
    currentEntry.value = await api.publish(props.handle, props.id);
    toasts.success('Published');
  } catch (err) {
    const e = err as { response?: { message?: string } };
    toasts.error(e.response?.message ?? 'Failed to publish');
  } finally {
    saving.value = false;
  }
}

async function unpublishNow() {
  if (!props.id) return;
  if (!window.confirm('Unpublish this entry? It will be removed from the public site.')) return;
  saving.value = true;
  try {
    currentEntry.value = await api.unpublish(props.handle, props.id);
    toasts.success('Unpublished');
  } catch (err) {
    const e = err as { response?: { message?: string } };
    toasts.error(e.response?.message ?? 'Failed to unpublish');
  } finally {
    saving.value = false;
  }
}

async function discardDraft() {
  if (!props.id) return;
  if (!window.confirm('Discard unpublished changes? This cannot be undone.')) return;
  saving.value = true;
  try {
    const entry = await api.discardDraft(props.handle, props.id);
    currentEntry.value = entry;
    Object.assign(state, entry.content);
    toasts.success('Draft discarded');
  } catch (err) {
    const e = err as { response?: { message?: string } };
    toasts.error(e.response?.message ?? 'Failed to discard');
  } finally {
    saving.value = false;
  }
}

function previewUrl(entry: Entry): string {
  const slug = (entry.draftContent?.slug ?? entry.content?.slug) as string | undefined;
  if (typeof slug !== 'string' || slug.length === 0) {
    return `/${props.handle}/${entry.id}`; // fallback when no slug
  }
  return `/${props.handle}/${slug}`;
}

async function openPreview() {
  if (!props.id || !currentEntry.value) return;
  try {
    const { token } = await api.previewToken(props.handle, props.id);
    const url = previewUrl(currentEntry.value);
    window.open(`${url}?vulse-preview=${encodeURIComponent(token)}`, '_blank');
  } catch (err) {
    const e = err as { response?: { message?: string } };
    toasts.error(e.response?.message ?? 'Failed to get preview token');
  }
}
</script>

<template>
  <div class="p-6" :data-testid="`collection-entry-${handle}`">
    <div v-if="!blueprint" class="text-sm text-zinc-500">Unknown collection.</div>
    <template v-else>
      <EntryBreadcrumb v-if="isTreeCollection" :handle="handle" :items="ancestors" />
      <div class="mb-4 flex items-center gap-3">
        <h1 class="text-xl font-semibold">{{ id ? 'Edit' : 'New' }} {{ blueprint.label }}</h1>
        <EntryStatusBadge v-if="id && currentEntry && draftsEnabled"
          :status="currentEntry.status"
          :has-unpublished-changes="currentEntry.hasUnpublishedChanges" />
      </div>
      <div v-if="id" class="mb-4 flex gap-1 border-b border-zinc-200" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'edit'"
          class="-mb-px border-b-2 px-3 py-2 text-sm font-medium"
          :class="activeTab === 'edit' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'"
          data-testid="tab-edit"
          @click="activeTab = 'edit'"
        >
          Edit
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'revisions'"
          class="-mb-px border-b-2 px-3 py-2 text-sm font-medium"
          :class="activeTab === 'revisions' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'"
          data-testid="tab-revisions"
          @click="activeTab = 'revisions'"
        >
          Revisions
        </button>
      </div>
      <div v-if="id && activeTab === 'revisions'" class="max-w-3xl">
        <RevisionsPanel :handle="handle" :id="id" @restored="loadEntry" />
      </div>
      <div v-if="loading && (!id || activeTab === 'edit')" class="text-sm text-zinc-500">Loading…</div>
      <form
        v-else-if="!id || activeTab === 'edit'"
        class="max-w-2xl space-y-4"
        @submit.prevent="() => save(draftsEnabled ? lastSaveAction : 'publish')"
      >
        <label v-if="isTreeCollection" class="block rounded border border-zinc-200 bg-white p-3">
          <span class="block text-sm font-semibold text-zinc-700">Parent</span>
          <span class="block text-xs text-zinc-500">Choose where this entry sits in the tree.</span>
          <select
            class="mt-2 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            data-testid="entry-parent"
            :value="parentId ?? ''"
            @change="parentId = ($event.target as HTMLSelectElement).value === '' ? null : ($event.target as HTMLSelectElement).value"
          >
            <option value="">— Root (no parent)</option>
            <option v-for="opt in parentOptions" :key="opt.id" :value="opt.id">
              {{ '— '.repeat(opt.depth) }}{{ opt.label }}
            </option>
          </select>
        </label>
        <FieldRenderer
          v-for="f in blueprint.fields"
          :key="f.name"
          :meta="f"
          :model-value="state[f.name]"
          :error="errors[f.name] ?? ''"
          @update:model-value="(v: unknown) => updateField(f.name, v)"
        />
        <div class="rounded border border-zinc-200 bg-white p-3">
          <h3 class="mb-2 text-sm font-semibold text-zinc-700">Visibility</h3>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="isProtected" type="checkbox" class="rounded border-zinc-300" data-testid="entry-protected" />
            <span class="text-zinc-700">Protected (requires sign-in to view)</span>
          </label>
        </div>
        <div v-if="submitError" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ submitError }}
        </div>
        <div class="flex items-center gap-2">
          <template v-if="draftsEnabled">
            <div class="inline-flex rounded shadow-sm" data-testid="save-split">
              <button
                type="button"
                class="vulse-button-primary rounded-l px-4 py-2 text-sm font-medium disabled:opacity-50"
                :disabled="saving || (lastSaveAction === 'publish' && !canPublish)"
                :data-testid="`submit-${lastSaveAction}`"
                @click="save(lastSaveAction)"
              >
                {{ saving ? 'Saving…' : (lastSaveAction === 'publish' ? 'Save & publish' : 'Save draft') }}
              </button>
              <details class="relative" @click.stop>
                <summary class="vulse-button-primary cursor-pointer rounded-r border-l border-zinc-700 px-2 py-2 text-sm">▾</summary>
                <div class="absolute right-0 z-10 mt-1 w-48 rounded border border-zinc-200 bg-white py-1 text-sm shadow">
                  <button type="button"
                    class="block w-full px-3 py-1.5 text-left hover:bg-zinc-50"
                    data-testid="save-as-draft"
                    @click="save('draft')">Save draft</button>
                  <button type="button"
                    class="block w-full px-3 py-1.5 text-left hover:bg-zinc-50 disabled:opacity-50"
                    :disabled="!canPublish"
                    data-testid="save-and-publish"
                    @click="save('publish')">Save & publish</button>
                  <button v-if="currentEntry?.hasUnpublishedChanges"
                    type="button"
                    class="block w-full px-3 py-1.5 text-left text-amber-700 hover:bg-amber-50"
                    data-testid="discard-draft"
                    @click="discardDraft">Discard draft</button>
                  <button v-if="currentEntry?.status === 'published' && canPublish"
                    type="button"
                    class="block w-full px-3 py-1.5 text-left text-zinc-600 hover:bg-zinc-50"
                    data-testid="unpublish"
                    @click="unpublishNow">Unpublish</button>
                </div>
              </details>
            </div>
          </template>
          <button v-else type="submit"
            class="vulse-button-primary rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
            :disabled="saving"
            data-testid="submit"
            @click.prevent="save('publish')">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>

          <button v-if="id && draftsEnabled && currentEntry
            && (currentEntry.hasUnpublishedChanges || currentEntry.status !== 'published')"
            type="button"
            class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            data-testid="preview-button"
            @click="openPreview"
          >
            Preview
          </button>

          <RouterLink :to="`/collections/${handle}`"
            class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            data-testid="cancel">Cancel</RouterLink>
        </div>
      </form>

      <div
        v-if="isTreeCollection && id && activeTab === 'edit' && !loading"
        class="mt-6 max-w-2xl"
        data-testid="entry-children"
      >
        <div class="rounded border border-zinc-200 bg-white p-3">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-zinc-700">Children</h3>
            <RouterLink
              :to="{ path: `/collections/${handle}/new`, query: { parent_id: id } }"
              class="rounded border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              data-testid="add-child"
            >
              + Add child
            </RouterLink>
          </div>
          <ul v-if="children.length > 0" class="divide-y divide-zinc-100">
            <li
              v-for="child in children"
              :key="child.id"
              class="flex items-center justify-between py-1.5"
            >
              <RouterLink
                :to="`/collections/${handle}/${child.id}`"
                class="text-sm text-zinc-700 hover:text-zinc-900 hover:underline"
              >
                {{ entryLabel(child) }}
              </RouterLink>
              <span class="text-xs text-zinc-400">#{{ child.sortOrder }}</span>
            </li>
          </ul>
          <p v-else class="text-sm text-zinc-500">No children yet.</p>
        </div>
      </div>
    </template>
  </div>
</template>
