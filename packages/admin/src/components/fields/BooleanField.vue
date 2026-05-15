<script setup lang="ts">
defineProps<{ name: string; modelValue: boolean | undefined; error?: string }>();
defineEmits<{ 'update:modelValue': [boolean] }>();
</script>

<template>
  <label class="flex items-center gap-2">
    <input
      type="checkbox"
      class="rounded border-zinc-300"
      :checked="!!modelValue"
      :data-testid="`field-${name}`"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <span v-if="error" class="text-xs text-red-600">{{ error }}</span>
  </label>
</template>
