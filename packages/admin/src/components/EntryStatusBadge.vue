<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  status: string;
  hasUnpublishedChanges: boolean;
}>();

const label = computed(() => {
  if (props.status !== 'published') return 'Draft';
  if (props.hasUnpublishedChanges) return 'Published · unpublished changes';
  return 'Published';
});

const tone = computed<'draft' | 'published' | 'mixed'>(() => {
  if (props.status !== 'published') return 'draft';
  if (props.hasUnpublishedChanges) return 'mixed';
  return 'published';
});
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
    :class="{
      'bg-amber-50 text-amber-800 ring-1 ring-amber-200': tone === 'draft',
      'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200': tone === 'published',
      'bg-emerald-50 text-emerald-800 ring-1 ring-amber-300': tone === 'mixed',
    }"
    :data-testid="`status-badge-${tone}`"
  >
    <span
      class="h-1.5 w-1.5 rounded-full"
      :class="{
        'bg-amber-500': tone === 'draft' || tone === 'mixed',
        'bg-emerald-500': tone === 'published',
      }"
    />
    {{ label }}
  </span>
</template>
