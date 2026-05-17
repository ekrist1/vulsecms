<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { watch } from 'vue';
import { EMPTY_BLOCKS_DOC, blocksEditorExtensions } from './blocks-editor-extensions.js';
import { sanitizeLinkHref } from './url-utils.js';

const props = defineProps<{
  name: string;
  modelValue: unknown;
  error?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [unknown] }>();

const editor = useEditor({
  extensions: blocksEditorExtensions,
  content: (props.modelValue as object) ?? EMPTY_BLOCKS_DOC,
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

function toggleLink() {
  const currentHref = (editor.value?.getAttributes('link').href as string | undefined) ?? '';
  const raw = window.prompt('Link URL', currentHref);
  if (raw === null) return;
  const href = sanitizeLinkHref(raw);
  if (!href) {
    editor.value?.chain().focus().unsetVulseLink().run();
    return;
  }

  if (editor.value?.state.selection.empty) {
    editor.value
      ?.chain()
      .focus()
      .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
      .run();
    return;
  }

  editor.value?.chain().focus().extendMarkRange('link').setVulseLink(href).run();
}

function insertEmoji() {
  const value = window.prompt('Emoji', '🙂');
  if (!value) return;
  const emoji = value.trim();
  if (!emoji) return;
  editor.value?.chain().focus().insertEmoji(emoji).run();
}

function insertAccordion() {
  editor.value?.chain().focus().insertVulseAccordionGroup('Accordion').run();
}

function insertIframe() {
  editor.value?.chain().focus().insertVulseIframe().run();
}

function insertVideo() {
  editor.value?.chain().focus().insertVulseVideo().run();
}
</script>

<template>
  <div :data-testid="`field-${name}`">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <div class="mt-1 rounded border border-zinc-300">
      <div class="flex flex-wrap gap-1 border-b border-zinc-200 bg-zinc-50 px-2 py-1 text-xs">
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-bold" @click="editor?.chain().focus().toggleBold().run()">B</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200 italic" data-testid="blocks-italic" @click="editor?.chain().focus().toggleItalic().run()">I</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-link" @click="toggleLink">Link</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-h2" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-h3" @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()">H3</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-h4" @click="editor?.chain().focus().toggleHeading({ level: 4 }).run()">H4</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-bullet-list" @click="editor?.chain().focus().toggleBulletList().run()">• List</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-ordered-list" @click="editor?.chain().focus().toggleOrderedList().run()">1. List</button>
        <span class="mx-1 w-px bg-zinc-300" />
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-emoji" @click="insertEmoji">Emoji</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-info" @click="insertCallout('info')">+ Info</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-warn" @click="insertCallout('warn')">+ Warn</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-accordion" @click="insertAccordion">Accordion</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-iframe" @click="insertIframe">Iframe</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" data-testid="blocks-video" @click="insertVideo">Video</button>
      </div>
      <EditorContent v-if="editor" :editor="editor" class="prose max-w-none p-3 text-sm" />
    </div>
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </div>
</template>
