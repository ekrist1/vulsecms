<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { watch } from 'vue';
import { VulseCalloutExtension } from './vulse-callout-extension.js';

const props = defineProps<{
  name: string;
  modelValue: unknown;
  error?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [unknown] }>();

const editor = useEditor({
  extensions: [StarterKit, VulseCalloutExtension],
  content: (props.modelValue as object) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getJSON());
  },
});

watch(
  () => props.modelValue,
  (v) => {
    if (!editor.value) return;
    const current = JSON.stringify(editor.value.getJSON());
    const incoming = JSON.stringify(v);
    if (current !== incoming && v) {
      editor.value.commands.setContent(v as object, false);
    }
  },
);

function insertCallout(tone: 'info' | 'warn') {
  editor.value?.chain().focus().insertVulseCallout(tone).run();
}
</script>

<template>
  <div :data-testid="`field-${name}`">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <div class="mt-1 rounded border border-zinc-300">
      <div class="flex gap-1 border-b border-zinc-200 bg-zinc-50 px-2 py-1 text-xs">
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="editor?.chain().focus().toggleBold().run()">B</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200 italic" @click="editor?.chain().focus().toggleItalic().run()">I</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="editor?.chain().focus().toggleBulletList().run()">• List</button>
        <span class="mx-1 w-px bg-zinc-300" />
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="insertCallout('info')">+ Info</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="insertCallout('warn')">+ Warn</button>
      </div>
      <EditorContent v-if="editor" :editor="editor" class="prose max-w-none p-3 text-sm" />
    </div>
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </div>
</template>
