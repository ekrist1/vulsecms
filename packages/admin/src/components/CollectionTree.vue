<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { type EntryNode, api } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';
import TreeRow from './TreeRow.vue';

const props = defineProps<{ handle: string }>();

const toasts = useToastsStore();
const tree = ref<EntryNode[]>([]);
const loading = ref(false);
const moving = ref(false);
const expanded = ref<Set<string>>(new Set());
const dragId = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    tree.value = await api.getTree(props.handle);
    // Auto-expand first two levels for visibility.
    for (const root of tree.value) {
      expanded.value.add(root.id);
      for (const child of root.children) expanded.value.add(child.id);
    }
  } catch {
    toasts.error('Could not load tree');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
  // Force reactivity for Set updates.
  expanded.value = new Set(expanded.value);
}

function entryLabel(entry: EntryNode): string {
  const c = entry.content;
  return (
    (c.title as string | undefined) ??
    (c.name as string | undefined) ??
    (c.label as string | undefined) ??
    entry.id
  );
}

// Build a flat list of descendant ids for cycle prevention.
function descendantIds(node: EntryNode): Set<string> {
  const out = new Set<string>([node.id]);
  function walk(n: EntryNode) {
    for (const c of n.children) {
      out.add(c.id);
      walk(c);
    }
  }
  walk(node);
  return out;
}

function findNode(nodes: EntryNode[], id: string): EntryNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

function siblingsOf(id: string): EntryNode[] {
  function walk(nodes: EntryNode[], parent: EntryNode[]): EntryNode[] | null {
    for (const n of nodes) {
      if (n.id === id) return parent;
      const found = walk(n.children, n.children);
      if (found) return found;
    }
    return null;
  }
  return walk(tree.value, tree.value) ?? [];
}

async function moveUp(id: string) {
  const siblings = siblingsOf(id);
  const idx = siblings.findIndex((s) => s.id === id);
  if (idx <= 0) return;
  moving.value = true;
  try {
    const node = siblings[idx]!;
    await api.moveEntry(props.handle, id, {
      parentId: node.parentId,
      sortOrder: idx, // 1-based, idx is 0-based; idx (0-based) = position idx, target sortOrder = idx (1-based-1+1)
    });
    await load();
  } catch {
    toasts.error('Could not move');
  } finally {
    moving.value = false;
  }
}

async function moveDown(id: string) {
  const siblings = siblingsOf(id);
  const idx = siblings.findIndex((s) => s.id === id);
  if (idx < 0 || idx >= siblings.length - 1) return;
  moving.value = true;
  try {
    const node = siblings[idx]!;
    await api.moveEntry(props.handle, id, {
      parentId: node.parentId,
      sortOrder: idx + 2, // shift down one
    });
    await load();
  } catch {
    toasts.error('Could not move');
  } finally {
    moving.value = false;
  }
}

async function outdent(id: string) {
  const node = findNode(tree.value, id);
  if (!node) return;
  // Find current parent, then promote to be a sibling of that parent.
  const currentParentId = node.parentId;
  if (currentParentId === null) return; // already at root
  const parent = findNode(tree.value, currentParentId);
  const grandparentId = parent?.parentId ?? null;
  moving.value = true;
  try {
    await api.moveEntry(props.handle, id, { parentId: grandparentId });
    await load();
  } catch {
    toasts.error('Could not outdent');
  } finally {
    moving.value = false;
  }
}

async function indent(id: string) {
  // Make the entry a child of its previous sibling.
  const siblings = siblingsOf(id);
  const idx = siblings.findIndex((s) => s.id === id);
  if (idx <= 0) return;
  const newParent = siblings[idx - 1]!;
  moving.value = true;
  try {
    await api.moveEntry(props.handle, id, { parentId: newParent.id });
    expanded.value.add(newParent.id);
    expanded.value = new Set(expanded.value);
    await load();
  } catch {
    toasts.error('Could not indent');
  } finally {
    moving.value = false;
  }
}

function onDragStart(event: DragEvent, id: string) {
  dragId.value = id;
  event.dataTransfer?.setData('text/plain', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOver(event: DragEvent) {
  if (dragId.value) event.preventDefault();
}

async function onDropOnto(event: DragEvent, targetId: string | null) {
  event.preventDefault();
  const src = dragId.value;
  dragId.value = null;
  if (!src || src === targetId) return;
  // Cycle guard: cannot drop a node onto its own descendant.
  const srcNode = findNode(tree.value, src);
  if (srcNode && targetId !== null) {
    const desc = descendantIds(srcNode);
    if (desc.has(targetId)) {
      toasts.error("Can't drop a page onto one of its descendants.");
      return;
    }
  }
  moving.value = true;
  try {
    await api.moveEntry(props.handle, src, { parentId: targetId });
    if (targetId) {
      expanded.value.add(targetId);
      expanded.value = new Set(expanded.value);
    }
    await load();
  } catch (err) {
    const e = err as { response?: { message?: string; issues?: Array<{ message?: string }> } };
    toasts.error(e.response?.issues?.[0]?.message ?? e.response?.message ?? 'Move failed');
  } finally {
    moving.value = false;
  }
}

async function destroy(id: string, label: string) {
  if (!confirm(`Delete "${label}" and any nested children? This cannot be undone.`)) return;
  try {
    await api.delete(props.handle, id);
    await load();
    toasts.success('Deleted');
  } catch {
    toasts.error('Could not delete');
  }
}
</script>

<template>
  <div data-testid="collection-tree">
    <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
    <div
      v-else-if="tree.length === 0"
      class="rounded border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500"
    >
      No pages yet. Use the “+ New” button to create your first entry.
    </div>
    <ul
      v-else
      class="divide-y divide-zinc-100 overflow-hidden rounded border border-zinc-200 bg-white"
      @dragover="onDragOver"
      @drop="(e) => onDropOnto(e, null)"
    >
      <TreeRow
        v-for="node in tree"
        :key="node.id"
        :node="node"
        :handle="handle"
        :depth="0"
        :expanded-set="expanded"
        :dragging-id="dragId"
        :disabled="moving"
        @toggle="toggle"
        @move-up="moveUp"
        @move-down="moveDown"
        @outdent="outdent"
        @indent="indent"
        @drag-start="onDragStart"
        @drag-over="onDragOver"
        @drop-onto="onDropOnto"
        @destroy="destroy"
      />
    </ul>
  </div>
</template>
