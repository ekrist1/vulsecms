<script setup lang="ts">
defineProps<{
  name: string;
  modelValue: string | undefined;
  options?: readonly string[];
  error?: string;
}>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <select
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
      :value="modelValue ?? ''"
      :data-testid="`field-${name}`"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="" disabled>Select…</option>
      <option v-for="o in options ?? []" :key="o" :value="o">{{ o }}</option>
    </select>
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </label>
</template>
