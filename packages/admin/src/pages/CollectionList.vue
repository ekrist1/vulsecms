<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { type Entry, type EntryListResponse, type FieldDefinition, api } from '../api/client.js';
import CollectionKindIcon from '../components/CollectionKindIcon.vue';
import { useBlueprintsStore } from '../stores/blueprints.js';

const props = defineProps<{ handle: string }>();

type ColumnKey = 'id' | 'updatedAt' | `field:${string}`;

interface ColumnOption {
  key: ColumnKey;
  label: string;
  kind: 'system' | 'field';
  field?: FieldDefinition;
}

const SEARCHABLE_FIELD_KINDS = new Set(['text', 'textarea', 'select', 'relationship', 'date']);
const LISTABLE_FIELD_KINDS = new Set([
  'text',
  'textarea',
  'select',
  'relationship',
  'date',
  'boolean',
]);

const EMPTY_RESULT: EntryListResponse = {
  items: [],
  total: 0,
  limit: 25,
  offset: 0,
};

const store = useBlueprintsStore();
const blueprint = computed(() => store.get(props.handle));

const entries = ref<EntryListResponse>({ ...EMPTY_RESULT });
const loading = ref(false);
const page = ref(1);
const pageSize = ref(25);
const searchDraft = ref('');
const searchQuery = ref('');
const searchField = ref('all');
const visibleColumnKeys = ref<ColumnKey[]>([]);
const singletonEntryId = ref<string | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let loadToken = 0;

const columnOptions = computed<ColumnOption[]>(() => {
  const fields =
    blueprint.value?.fields
      .filter((field) => LISTABLE_FIELD_KINDS.has(field.ui.kind))
      .map((field) => ({
        key: `field:${field.name}` as const,
        label: field.label?.trim() || humanize(field.name),
        kind: 'field' as const,
        field,
      })) ?? [];

  return [
    { key: 'id', label: 'ID', kind: 'system' as const },
    ...fields,
    { key: 'updatedAt', label: 'Updated', kind: 'system' as const },
  ];
});

const visibleColumns = computed<ColumnOption[]>(() => {
  const byKey = new Map(columnOptions.value.map((column) => [column.key, column]));
  const columns = visibleColumnKeys.value
    .map((key) => byKey.get(key))
    .filter((column): column is ColumnOption => Boolean(column));
  return columns.length > 0 ? columns : defaultVisibleColumns(columnOptions.value);
});

const searchScopes = computed(() => {
  const fieldScopes =
    blueprint.value?.fields
      .filter((field) => SEARCHABLE_FIELD_KINDS.has(field.ui.kind))
      .map((field) => ({
        value: field.name,
        label: field.label?.trim() || humanize(field.name),
      })) ?? [];

  return [
    { value: 'all', label: 'All searchable fields' },
    { value: 'id', label: 'ID' },
    { value: 'updatedAt', label: 'Updated' },
    ...fieldScopes,
  ];
});

const totalPages = computed(() =>
  Math.max(1, Math.ceil(entries.value.total / Math.max(1, pageSize.value))),
);
const showingStart = computed(() => (entries.value.total === 0 ? 0 : entries.value.offset + 1));
const showingEnd = computed(() => entries.value.offset + entries.value.items.length);
const collectionLabel = computed(() => blueprint.value?.label ?? props.handle);
const isSingleton = computed(() => blueprint.value?.singleton ?? false);
const collectionTypeLabel = computed(() =>
  isSingleton.value ? 'Singleton collection' : 'Collection',
);
const hasFilters = computed(() => searchQuery.value.length > 0 || searchField.value !== 'all');
const primaryEntryAction = computed(() => {
  if (isSingleton.value && singletonEntryId.value) {
    return {
      label: 'Open entry',
      to: `/collections/${props.handle}/${singletonEntryId.value}`,
    };
  }
  return {
    label: isSingleton.value ? 'Create entry' : 'New entry',
    to: `/collections/${props.handle}/new`,
  };
});

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function defaultVisibleColumns(columns: ColumnOption[]): ColumnOption[] {
  const preferredKeys: ColumnKey[] = ['id'];
  const fieldKeys = columns
    .filter((column) => column.kind === 'field')
    .slice(0, 3)
    .map((column) => column.key);
  preferredKeys.push(...fieldKeys, 'updatedAt');

  const allowed = new Map(columns.map((column) => [column.key, column]));
  const unique = [...new Set(preferredKeys)];
  return unique
    .map((key) => allowed.get(key))
    .filter((column): column is ColumnOption => Boolean(column));
}

function columnsStorageKey(handle: string): string {
  return `vulse.collection.columns.${handle}`;
}

function restoreVisibleColumns(handle: string) {
  const columns = columnOptions.value;
  if (columns.length === 0) {
    visibleColumnKeys.value = ['id', 'updatedAt'];
    return;
  }

  try {
    const raw = localStorage.getItem(columnsStorageKey(handle));
    if (!raw) {
      visibleColumnKeys.value = defaultVisibleColumns(columns).map((column) => column.key);
      return;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('invalid column state');
    const allowed = new Set(columns.map((column) => column.key));
    const next = parsed.filter((key): key is ColumnKey => typeof key === 'string' && allowed.has(key as ColumnKey));
    visibleColumnKeys.value =
      next.length > 0 ? next : defaultVisibleColumns(columns).map((column) => column.key);
  } catch {
    visibleColumnKeys.value = defaultVisibleColumns(columns).map((column) => column.key);
  }
}

function saveVisibleColumns(handle: string) {
  try {
    localStorage.setItem(columnsStorageKey(handle), JSON.stringify(visibleColumnKeys.value));
  } catch {
    // ignore storage failures
  }
}

function isColumnVisible(key: ColumnKey): boolean {
  return visibleColumns.value.some((column) => column.key === key);
}

function toggleColumn(key: ColumnKey) {
  if (isColumnVisible(key)) {
    if (visibleColumns.value.length === 1) return;
    visibleColumnKeys.value = visibleColumnKeys.value.filter((columnKey) => columnKey !== key);
    return;
  }

  const fallback = defaultVisibleColumns(columnOptions.value).map((column) => column.key);
  const next =
    visibleColumnKeys.value.length > 0 ? [...visibleColumnKeys.value, key] : [...fallback, key];
  visibleColumnKeys.value = [...new Set(next)];
}

function fieldNameFromColumn(column: ColumnOption): string | null {
  return column.kind === 'field' ? column.field?.name ?? null : null;
}

function valueForColumn(entry: Entry, column: ColumnOption): string {
  if (column.key === 'id') return entry.id;
  if (column.key === 'updatedAt') return entry.updatedAt;

  const fieldName = fieldNameFromColumn(column);
  if (!fieldName) return '—';

  const value = (entry.content as Record<string, unknown>)[fieldName];
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? '—' : `${value.length} items`;
  return JSON.stringify(value);
}

function truncate(value: string, max = 64): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function renderCell(entry: Entry, column: ColumnOption): string {
  return truncate(valueForColumn(entry, column));
}

function resetListState(handle: string) {
  page.value = 1;
  pageSize.value = 25;
  searchDraft.value = '';
  searchQuery.value = '';
  searchField.value = 'all';
  entries.value = { ...EMPTY_RESULT };
  restoreVisibleColumns(handle);
}

async function load(handle: string) {
  loading.value = true;
  const token = ++loadToken;

  try {
    const result = await api.list(handle, {
      limit: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
      ...(searchQuery.value ? { q: searchQuery.value } : {}),
      ...(searchField.value !== 'all' ? { field: searchField.value } : {}),
    });

    if (token !== loadToken) return;

    const nextTotalPages = Math.max(1, Math.ceil(result.total / result.limit));
    if (result.total > 0 && page.value > nextTotalPages) {
      page.value = nextTotalPages;
      return;
    }

    entries.value = result;
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

async function loadSingletonEntry(handle: string) {
  if (!isSingleton.value) {
    singletonEntryId.value = null;
    return;
  }

  const result = await api.list(handle, { limit: 1, offset: 0 });
  singletonEntryId.value = result.items[0]?.id ?? null;
}

async function remove(id: string) {
  if (!confirm('Delete this entry?')) return;
  await api.delete(props.handle, id);
  if (entries.value.items.length === 1 && page.value > 1) {
    page.value -= 1;
    return;
  }
  await load(props.handle);
  await loadSingletonEntry(props.handle);
}

function clearFilters() {
  searchDraft.value = '';
  searchQuery.value = '';
  searchField.value = 'all';
  page.value = 1;
}

watch(
  () => props.handle,
  (handle) => resetListState(handle),
  { immediate: true },
);

watch(columnOptions, () => restoreVisibleColumns(props.handle));

watch(visibleColumnKeys, () => saveVisibleColumns(props.handle), { deep: true });

watch(searchField, () => {
  page.value = 1;
});

watch(pageSize, () => {
  page.value = 1;
});

watch(searchDraft, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    searchQuery.value = value.trim();
  }, 250);
});

watch(
  [() => props.handle, page, pageSize, searchField, searchQuery],
  ([handle]) => {
    void load(handle);
  },
  { immediate: true },
);

watch(
  [() => props.handle, isSingleton],
  ([handle]) => {
    void loadSingletonEntry(handle);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="p-6" :data-testid="`collection-list-${handle}`">
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="flex items-center gap-3 text-2xl font-semibold">
          <CollectionKindIcon :singleton="isSingleton" class="h-5 w-5" />
          <span>{{ collectionLabel }}</span>
        </h1>
        <p class="mt-1 text-sm text-zinc-500">
          {{ entries.total }} {{ entries.total === 1 ? 'entry' : 'entries' }}
        </p>
        <div class="mt-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600">
          <CollectionKindIcon :singleton="isSingleton" />
          <span>{{ collectionTypeLabel }}</span>
        </div>
      </div>
      <RouterLink
        :to="primaryEntryAction.to"
        class="vulse-button-primary rounded px-3 py-1.5 text-sm font-medium"
        data-testid="new-entry"
      >
        {{ primaryEntryAction.label }}
      </RouterLink>
    </div>

    <div class="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-3">
      <label class="min-w-[16rem] flex-1">
        <span class="block text-xs font-medium uppercase tracking-wide text-zinc-500">Search</span>
        <input
          v-model="searchDraft"
          type="search"
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          :placeholder="`Search ${collectionLabel.toLowerCase()}`"
          data-testid="collection-search"
        />
      </label>

      <label class="w-56">
        <span class="block text-xs font-medium uppercase tracking-wide text-zinc-500">Filter</span>
        <select
          v-model="searchField"
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          data-testid="collection-search-field"
        >
          <option v-for="scope in searchScopes" :key="scope.value" :value="scope.value">
            {{ scope.label }}
          </option>
        </select>
      </label>

      <details class="relative w-56" data-testid="collection-columns">
        <summary class="mt-[1.3125rem] cursor-pointer rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-700">
          Columns ({{ visibleColumns.length }})
        </summary>
        <div class="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
          <p class="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Visible columns</p>
          <label
            v-for="column in columnOptions"
            :key="column.key"
            class="flex items-center justify-between gap-3 py-1 text-sm text-zinc-700"
          >
            <span>{{ column.label }}</span>
            <input
              type="checkbox"
              :checked="isColumnVisible(column.key)"
              :disabled="visibleColumns.length === 1 && isColumnVisible(column.key)"
              :data-testid="`column-toggle-${column.key}`"
              @change="toggleColumn(column.key)"
            />
          </label>
        </div>
      </details>

      <label class="w-28">
        <span class="block text-xs font-medium uppercase tracking-wide text-zinc-500">Rows</span>
        <select
          v-model.number="pageSize"
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          data-testid="collection-page-size"
        >
          <option :value="10">10</option>
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </label>

      <button
        type="button"
        class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        :disabled="!hasFilters"
        data-testid="collection-clear-filters"
        @click="clearFilters"
      >
        Clear
      </button>
    </div>

    <div
      v-if="loading && entries.total === 0"
      class="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500"
    >
      Loading…
    </div>
    <div
      v-else-if="entries.total === 0"
      class="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500"
    >
      {{ hasFilters ? 'No entries match the current search.' : 'No entries yet.' }}
    </div>
    <div v-else class="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th v-for="column in visibleColumns" :key="column.key" class="px-4 py-3">
                {{ column.label }}
              </th>
              <th class="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries.items" :key="entry.id" class="border-b border-zinc-100 last:border-b-0">
              <td
                v-for="(column, index) in visibleColumns"
                :key="column.key"
                class="px-4 py-3 align-top"
                :class="{
                  'font-mono text-xs text-zinc-500': column.key === 'id',
                  'text-zinc-500': column.key === 'updatedAt',
                }"
              >
                <RouterLink
                  v-if="index === 0"
                  :to="`/collections/${handle}/${entry.id}`"
                  class="block max-w-[20rem] truncate hover:underline"
                >
                  {{ renderCell(entry, column) }}
                </RouterLink>
                <span v-else class="block max-w-[20rem] truncate">
                  {{ renderCell(entry, column) }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  class="text-xs text-red-600 hover:underline"
                  :data-testid="`delete-${entry.id}`"
                  @click="remove(entry.id)"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      v-if="entries.total > 0"
      class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-500"
    >
      <div data-testid="collection-pagination-summary">
        Showing {{ showingStart }}-{{ showingEnd }} of {{ entries.total }}
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded border border-zinc-300 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="page <= 1 || loading"
          data-testid="collection-page-prev"
          @click="page -= 1"
        >
          Previous
        </button>
        <span data-testid="collection-page-indicator">Page {{ page }} of {{ totalPages }}</span>
        <button
          type="button"
          class="rounded border border-zinc-300 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="page >= totalPages || loading"
          data-testid="collection-page-next"
          @click="page += 1"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
