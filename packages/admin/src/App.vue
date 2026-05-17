<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import logoUrl from './assets/logo-mark.svg';
import Toasts from './components/Toasts.vue';
import { useAuthStore } from './stores/auth.js';
import { useBlueprintsStore } from './stores/blueprints.js';

const store = useBlueprintsStore();
const auth = useAuthStore();
const router = useRouter();

async function signOut() {
  await auth.logout();
  router.push('/login');
}

const SCHEMA_OPEN_KEY = 'vulse.sidebar.schema.open';
const schemaOpen = ref(false);

onMounted(async () => {
  try {
    schemaOpen.value = localStorage.getItem(SCHEMA_OPEN_KEY) === '1';
  } catch {
    // localStorage unavailable (SSR, sandboxed iframes) — leave default.
  }
  await store.hydrate();
  const first = store.list[0];
  if (first && router.currentRoute.value.path === '/loading') {
    router.replace(`/collections/${first.handle}`);
  }
});

watch(schemaOpen, (v) => {
  try {
    localStorage.setItem(SCHEMA_OPEN_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
});
</script>

<template>
  <div class="flex h-full">
    <aside class="w-[var(--vulse-sidebar-width)] border-r border-zinc-200 bg-white">
      <div class="px-4 py-3 font-semibold tracking-tight">
        <img class="inline-block h-8 w-8" :src="logoUrl" alt="Logo" />
        Vulse
      </div>
      <div v-if="auth.user" class="border-y border-zinc-100 px-4 py-2 text-xs">
        <div class="font-mono text-zinc-700" data-testid="user-chip">{{ auth.user.email }}</div>
        <button
          type="button"
          class="mt-1 text-zinc-500 hover:text-zinc-900"
          data-testid="sign-out"
          @click="signOut"
        >
          Sign out
        </button>
      </div>
      <nav class="px-2">
        <div class="px-2 pt-2 text-xs uppercase tracking-wide text-zinc-500">Collections</div>
        <RouterLink
          v-for="bp in store.list"
          :key="`coll-${bp.handle}`"
          :to="`/collections/${bp.handle}`"
          class="vulse-nav-link rounded-xl text-sm text-zinc-800"
          active-class="vulse-nav-link-active"
          :data-testid="`nav-${bp.handle}`"
        >
          {{ bp.label }}
        </RouterLink>

        <div class="px-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">Settings</div>
        <button
          type="button"
          class="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100"
          data-testid="settings-schema-toggle"
          aria-controls="settings-schema-children"
          :aria-expanded="schemaOpen"
          @click="schemaOpen = !schemaOpen"
        >
          <span class="inline-block w-3 text-zinc-400">{{ schemaOpen ? '▾' : '▸' }}</span>
          <span>Schema</span>
        </button>
        <div v-if="schemaOpen" id="settings-schema-children" class="ml-4" data-testid="settings-schema-children">
          <RouterLink
            v-for="bp in store.list"
            :key="`schema-${bp.handle}`"
            :to="`/schema/${bp.handle}`"
            class="vulse-nav-link rounded-xl text-sm text-zinc-800"
            active-class="vulse-nav-link-active"
            :data-testid="`schema-nav-${bp.handle}`"
          >
            {{ bp.label }}
          </RouterLink>
          <RouterLink
            to="/schema/new"
            class="vulse-nav-link rounded-xl text-sm text-zinc-600"
            active-class="vulse-nav-link-active"
            data-testid="schema-nav-new"
          >
            + New collection
          </RouterLink>
        </div>
      </nav>
    </aside>
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
    <Toasts />
  </div>
</template>
