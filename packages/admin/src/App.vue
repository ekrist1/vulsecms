<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useBlueprintsStore } from './stores/blueprints.js';

const store = useBlueprintsStore();
const router = useRouter();

onMounted(async () => {
  await store.hydrate();
  const first = store.list[0];
  if (first && router.currentRoute.value.path === '/loading') {
    router.replace(`/collections/${first.handle}`);
  }
});
</script>

<template>
  <div class="flex h-full">
    <aside class="w-[var(--vulse-sidebar-width)] border-r border-zinc-200 bg-white">
      <div class="px-4 py-3 font-semibold tracking-tight">Vulse</div>
      <nav class="px-2">
        <div class="px-2 pt-2 text-xs uppercase tracking-wide text-zinc-500">Collections</div>
        <RouterLink
          v-for="bp in store.list"
          :key="bp.handle"
          :to="`/collections/${bp.handle}`"
          class="block rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
          active-class="bg-zinc-100 font-medium"
          :data-testid="`nav-${bp.handle}`"
        >
          {{ bp.label }}
        </RouterLink>

        <!-- Door-open slots for later milestones:
        <div class="px-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">Navigation</div>
        <div class="px-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">Settings</div>
        -->
      </nav>
    </aside>
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>
</template>
