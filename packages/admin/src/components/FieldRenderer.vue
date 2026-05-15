<script setup lang="ts">
import { type Component, computed } from 'vue';
import type { FieldMeta } from '../api/client.js';
import BlocksField from './fields/BlocksField.vue';
import BooleanField from './fields/BooleanField.vue';
import DateField from './fields/DateField.vue';
import RelationshipField from './fields/RelationshipField.vue';
import SelectField from './fields/SelectField.vue';
import TextField from './fields/TextField.vue';
import TextareaField from './fields/TextareaField.vue';

const props = defineProps<{
  meta: FieldMeta;
  modelValue: unknown;
  error?: string;
}>();
defineEmits<{ 'update:modelValue': [unknown] }>();

const component = computed<Component>(() => {
  switch (props.meta.ui.kind) {
    case 'text':
      return TextField as Component;
    case 'textarea':
      return TextareaField as Component;
    case 'date':
      return DateField as Component;
    case 'boolean':
      return BooleanField as Component;
    case 'select':
      return SelectField as Component;
    case 'blocks':
      return BlocksField as Component;
    case 'relationship':
      return RelationshipField as Component;
  }
});
</script>

<template>
  <component
    :is="component"
    :name="meta.name"
    :model-value="modelValue"
    :options="meta.ui.options"
    :to="meta.ui.to"
    :error="error"
    @update:model-value="(v: unknown) => $emit('update:modelValue', v)"
  />
</template>
