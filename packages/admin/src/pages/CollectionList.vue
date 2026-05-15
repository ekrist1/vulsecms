<script setup lang="ts">
defineProps<{ handle: string }>();
</script>
<template>
  <div class="p-6" :data-testid="`collection-list-${handle}`">
    <h1 class="text-xl font-semibold">{{ handle }}</h1>
  </div>
</template>
