<script setup lang="ts">
defineProps<{ name: string; modelValue: string | undefined; error?: string }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <input
      type="text"
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
      :value="modelValue ?? ''"
      :data-testid="`field-${name}`"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </label>
</template>
