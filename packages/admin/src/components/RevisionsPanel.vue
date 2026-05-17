<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { type RevisionDetail, type RevisionSummary, api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useToastsStore } from '../stores/toasts.js';

const props = defineProps<{ handle: string; id: string }>();
const emit = defineEmits<{ restored: [] }>();

const auth = useAuthStore();
const toasts = useToastsStore();

const items = ref<RevisionSummary[]>([]);
const loading = ref(false);
const expandedId = ref<string | null>(null);
const detail = ref<RevisionDetail | null>(null);
const detailLoading = ref(false);
const restoring = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    const res = await api.listRevisions(props.handle, props.id, { limit: 100 });
    items.value = res.items;
  } catch {
    toasts.error('Could not load revisions');
  } finally {
    loading.value = false;
  }
}

async function toggle(rev: RevisionSummary) {
  if (expandedId.value === rev.id) {
    expandedId.value = null;
    detail.value = null;
    return;
  }
  expandedId.value = rev.id;
  detail.value = null;
  detailLoading.value = true;
  try {
    detail.value = await api.getRevision(props.handle, props.id, rev.id);
  } catch {
    toasts.error('Could not load revision');
    expandedId.value = null;
  } finally {
    detailLoading.value = false;
  }
}

async function restore(rev: RevisionSummary) {
  if (
    !confirm(
      `Restore revision #${rev.revisionNumber}? This will replace the entry's current content. A new revision will be created for the rollback so this is reversible.`,
    )
  )
    return;
  restoring.value = rev.id;
  try {
    await api.restoreRevision(props.handle, props.id, rev.id);
    toasts.success(`Restored revision #${rev.revisionNumber}`);
    emit('restored');
    await load();
  } catch {
    toasts.error('Could not restore revision');
  } finally {
    restoring.value = null;
  }
}

function attribute(rev: RevisionSummary): string {
  if (!rev.createdBy) return 'system';
  if (rev.createdBy === auth.user?.id) return 'you';
  return rev.createdBy.slice(0, 8);
}

function formatDate(iso: string): string {
  // SQLite returns "YYYY-MM-DD HH:MM:SS" (UTC). Normalise to a Date.
  const safe = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(safe);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const canRestore = computed(() => auth.can(props.handle, 'update'));

onMounted(load);
watch(() => [props.handle, props.id], load);
</script>

<template>
  <div class="space-y-3" data-testid="revisions-panel">
    <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
    <div v-else-if="items.length === 0" class="text-sm text-zinc-500">
      No revisions yet.
    </div>
    <div v-else class="divide-y divide-zinc-200 overflow-hidden rounded border border-zinc-200 bg-white">
      <div
        v-for="(rev, index) in items"
        :key="rev.id"
        class="flex flex-col"
        :data-testid="`revision-row-${rev.revisionNumber}`"
      >
        <div class="flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            class="flex flex-1 items-center gap-2 text-left"
            :aria-expanded="expandedId === rev.id"
            @click="toggle(rev)"
          >
            <svg
              class="h-4 w-4 shrink-0 text-zinc-400 transition-transform"
              :class="{ 'rotate-180': expandedId === rev.id }"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
            </svg>
            <span class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-zinc-700">
              #{{ rev.revisionNumber }}
            </span>
            <span
              v-if="index === 0"
              class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800"
            >
              Current
            </span>
            <span class="text-sm text-zinc-700">{{ formatDate(rev.createdAt) }}</span>
            <span class="text-xs text-zinc-500">by {{ attribute(rev) }}</span>
          </button>
          <button
            v-if="canRestore && index !== 0"
            type="button"
            class="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            :disabled="restoring === rev.id"
            :data-testid="`revision-restore-${rev.revisionNumber}`"
            @click="restore(rev)"
          >
            {{ restoring === rev.id ? 'Restoring…' : 'Restore' }}
          </button>
        </div>
        <div v-if="expandedId === rev.id" class="border-t border-zinc-200 bg-zinc-50 px-3 py-2">
          <div v-if="detailLoading" class="text-xs text-zinc-500">Loading content…</div>
          <pre
            v-else-if="detail"
            class="max-h-96 overflow-auto rounded bg-white p-3 font-mono text-[11px] text-zinc-700"
          >{{ JSON.stringify(detail.content, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
