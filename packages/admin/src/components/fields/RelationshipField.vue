<script setup lang="ts">
defineProps<{ name: string; modelValue: string | undefined; to?: string }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <input
      type="text"
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
      :value="modelValue ?? ''"
      :data-testid="`field-${name}`"
      :placeholder="`id of related ${to}`"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </label>
</template>
