<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { type DatabaseSummary, api } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';

const toasts = useToastsStore();
const summary = ref<DatabaseSummary | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    summary.value = await api.getDatabaseSummary();
  } catch {
    toasts.error('Could not load database status');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const driverLabel = computed(() => {
  const s = summary.value;
  if (!s) return '';
  if (s.scheme === 'libsql') return 'Turso (or remote libSQL)';
  if (s.scheme === 'file') return 'Local libSQL (SQLite file)';
  if (s.scheme === 'memory') return 'In-memory libSQL (tests / ephemeral)';
  if (s.scheme === 'http' || s.scheme === 'https') return 'libSQL over HTTP';
  if (s.scheme === 'ws' || s.scheme === 'wss') return 'libSQL over WebSocket';
  return s.driver;
});
</script>

<template>
  <div class="p-6">
    <h1 class="mb-1 text-xl font-semibold">Database</h1>
    <p class="mb-4 max-w-2xl text-sm text-zinc-600">
      Vulse uses a libSQL-compatible store. You can run a local SQLite file, point at a
      <a class="underline" href="https://docs.turso.tech/turso-cloud" target="_blank" rel="noopener">Turso Cloud</a>
      database, or use an embedded replica for low-latency reads with a remote master. Configuration
      is set through environment variables and applied at startup.
    </p>

    <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
    <div
      v-else-if="summary"
      class="mb-6 max-w-2xl rounded border border-zinc-200 bg-white p-4"
      data-testid="database-status"
    >
      <dl class="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
        <dt class="text-zinc-500">Driver</dt>
        <dd class="font-medium">{{ driverLabel }}</dd>
        <dt class="text-zinc-500">Scheme</dt>
        <dd class="font-mono">{{ summary.scheme }}</dd>
        <dt class="text-zinc-500">Host</dt>
        <dd class="font-mono">{{ summary.host ?? '—' }}</dd>
        <template v-if="summary.embeddedReplica">
          <dt class="text-zinc-500">Replica of</dt>
          <dd class="font-mono">{{ summary.syncUrlHost ?? '—' }}</dd>
        </template>
        <dt class="text-zinc-500">Remote</dt>
        <dd>{{ summary.remote ? 'yes' : 'no' }}</dd>
        <dt class="text-zinc-500">Encrypted at rest</dt>
        <dd>{{ summary.encrypted ? 'yes' : 'no' }}</dd>
      </dl>
    </div>

    <section class="max-w-2xl space-y-4 text-sm text-zinc-700">
      <h2 class="text-base font-semibold">Switching to Turso Cloud</h2>
      <ol class="list-decimal space-y-2 pl-5">
        <li>
          Create a database in the Turso dashboard or with the CLI
          (<code class="rounded bg-zinc-100 px-1">turso db create my-vulse</code>) and create a non-expiring
          auth token (<code class="rounded bg-zinc-100 px-1">turso db tokens create my-vulse</code>).
        </li>
        <li>
          Set the following environment variables before starting Vulse:
          <pre class="mt-1 overflow-x-auto rounded bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-50"><code>VULSE_DB_URL=libsql://my-vulse-org.turso.io
VULSE_DB_AUTH_TOKEN=&lt;token&gt;</code></pre>
        </li>
        <li>
          For low-latency reads with a remote master, set
          <code class="rounded bg-zinc-100 px-1">VULSE_DB_URL=file:./replica.db</code> and
          <code class="rounded bg-zinc-100 px-1">VULSE_DB_SYNC_URL=libsql://…</code>
          alongside the auth token; optionally set
          <code class="rounded bg-zinc-100 px-1">VULSE_DB_SYNC_INTERVAL</code>
          (in seconds) for periodic sync.
        </li>
        <li>
          Restart Vulse. Migrations are applied automatically on startup.
        </li>
      </ol>

      <h2 class="text-base font-semibold pt-2">Migrating an existing local database</h2>
      <p>
        Use the bundled script to copy a local libSQL file to Turso. It runs Vulse migrations on the
        destination first, then streams rows table by table.
      </p>
      <pre class="overflow-x-auto rounded bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-50"><code>pnpm --filter @vulse/dev db:migrate-to-turso \
  --source file:./dev.db \
  --target $TURSO_DATABASE_URL \
  --token  $TURSO_AUTH_TOKEN
# add --truncate to wipe the destination tables first
# add --dry-run to see what would be copied</code></pre>
    </section>
  </div>
</template>
