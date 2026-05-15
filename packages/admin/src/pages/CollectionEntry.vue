<script setup lang="ts">
defineProps<{ handle: string; id: string | null }>();
</script>
<template>
  <div class="p-6" :data-testid="`collection-entry-${handle}`">
    {{ id ?? 'new' }}
  </div>
</template>
