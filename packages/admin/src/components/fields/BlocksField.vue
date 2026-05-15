<script setup lang="ts">
defineProps<{ name: string; modelValue: unknown }>();
defineEmits<{ 'update:modelValue': [unknown] }>();
</script>

<template>
  <div :data-testid="`field-${name}`" class="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
    Block editor (TipTap) — wired in Task E4
  </div>
</template>
