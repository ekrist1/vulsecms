<script setup lang="ts">
import { computed, inject } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import DefaultLayout from './layouts/DefaultLayout.vue';
import { SITE_LAYOUTS_KEY } from './runtime/layouts.js';

const route = useRoute();
const layouts = inject(SITE_LAYOUTS_KEY, { default: DefaultLayout });
const layout = computed(() => {
  const name = String(route.meta.layout ?? 'default');
  return layouts[name] ?? layouts.default ?? DefaultLayout;
});
</script>

<template>
  <component :is="layout">
    <RouterView />
  </component>
</template>
