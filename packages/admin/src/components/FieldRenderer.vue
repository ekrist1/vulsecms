<script setup lang="ts">
import { computed } from 'vue';
import type { FieldMeta } from '../api/client.js';
import TextField from './fields/TextField.vue';
import TextareaField from './fields/TextareaField.vue';
import DateField from './fields/DateField.vue';
import BooleanField from './fields/BooleanField.vue';
import SelectField from './fields/SelectField.vue';
import BlocksField from './fields/BlocksField.vue';
import RelationshipField from './fields/RelationshipField.vue';

const props = defineProps<{
  meta: FieldMeta;
  modelValue: unknown;
  error?: string;
}>();
defineEmits<{ 'update:modelValue': [unknown] }>();

const component = computed(() => {
  switch (props.meta.ui.kind) {
    case 'text':         return TextField;
    case 'textarea':     return TextareaField;
    case 'date':         return DateField;
    case 'boolean':      return BooleanField;
    case 'select':       return SelectField;
    case 'blocks':       return BlocksField;
    case 'relationship': return RelationshipField;
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
