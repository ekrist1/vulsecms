# Schema UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the schema-editing flow with a label-first form, computed
handle, empty-state guidance, a collapsible Settings sidebar group, and a
shared toast notification primitive used by blueprint and entry saves.

**Architecture:** All changes live in the admin package. Toasts are a Pinia
store + a single `<Toasts />` component mounted once in `App.vue`. The
sidebar is restructured directly in `App.vue` with a small `ref` + local
storage for the Schema collapse state. The blueprint editor gets label-first
ordering, a `slugify` helper, a `handleLocked` flag, and an empty-state
branch in its Fields section. Toasts are wired into both `BlueprintEditor`
save/delete and `CollectionEntry` save.

**Tech Stack:** Vue 3 (Composition API), Pinia, Tailwind v4, Vitest +
@vue/test-utils + jsdom.

**Reference spec:** `docs/superpowers/specs/2026-05-16-schema-ux-improvements-design.md`

---

## File Map

- Create: `packages/admin/src/stores/toasts.ts`
- Create: `packages/admin/src/components/Toasts.vue`
- Create: `packages/admin/src/stores/__tests__/toasts.test.ts`
- Modify: `packages/admin/src/App.vue`
- Modify: `packages/admin/src/pages/BlueprintEditor.vue`
- Modify: `packages/admin/src/pages/CollectionEntry.vue`
- Modify: `packages/admin/src/pages/__tests__/BlueprintEditor.test.ts`

---

## Task 1: Toast store

**Files:**
- Create: `packages/admin/src/stores/toasts.ts`
- Create: `packages/admin/src/stores/__tests__/toasts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/admin/src/stores/__tests__/toasts.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastsStore } from '../toasts.js';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

describe('useToastsStore', () => {
  it('success() pushes an auto-dismissing toast', () => {
    const t = useToastsStore();
    t.success('Saved');
    expect(t.list).toHaveLength(1);
    expect(t.list[0]).toMatchObject({ kind: 'success', message: 'Saved' });
    vi.advanceTimersByTime(4000);
    expect(t.list).toHaveLength(0);
  });

  it('error() pushes a persistent toast', () => {
    const t = useToastsStore();
    t.error('Boom');
    expect(t.list).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(t.list).toHaveLength(1);
  });

  it('info() pushes an auto-dismissing toast', () => {
    const t = useToastsStore();
    t.info('FYI');
    expect(t.list).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(t.list).toHaveLength(0);
  });

  it('dismiss() removes by id and cancels the auto-dismiss timer', () => {
    const t = useToastsStore();
    t.success('one');
    t.success('two');
    const firstId = t.list[0]!.id;
    t.dismiss(firstId);
    expect(t.list.map((x) => x.message)).toEqual(['two']);
    // Advancing past auto-dismiss should clear the second one too without throwing.
    vi.advanceTimersByTime(4000);
    expect(t.list).toHaveLength(0);
  });

  it('assigns monotonically increasing ids', () => {
    const t = useToastsStore();
    t.success('a');
    t.success('b');
    t.success('c');
    const ids = t.list.map((x) => x.id);
    expect(ids[1]).toBeGreaterThan(ids[0]!);
    expect(ids[2]).toBeGreaterThan(ids[1]!);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm --filter @vulse/admin test -- toasts
```

Expected: FAIL with "Cannot find module '../toasts.js'".

- [ ] **Step 3: Implement the store**

Create `packages/admin/src/stores/toasts.ts`:

```ts
import { defineStore } from 'pinia';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const AUTO_DISMISS_MS = 4000;

export const useToastsStore = defineStore('toasts', {
  state: () => ({
    list: [] as Toast[],
    _nextId: 1,
    _timers: new Map<number, ReturnType<typeof setTimeout>>(),
  }),
  actions: {
    success(message: string) {
      this._push('success', message, AUTO_DISMISS_MS);
    },
    error(message: string) {
      this._push('error', message, null);
    },
    info(message: string) {
      this._push('info', message, AUTO_DISMISS_MS);
    },
    dismiss(id: number) {
      const idx = this.list.findIndex((t) => t.id === id);
      if (idx !== -1) this.list.splice(idx, 1);
      const timer = this._timers.get(id);
      if (timer) {
        clearTimeout(timer);
        this._timers.delete(id);
      }
    },
    _push(kind: ToastKind, message: string, dismissAfter: number | null) {
      const id = this._nextId++;
      this.list.push({ id, kind, message });
      if (dismissAfter !== null) {
        const timer = setTimeout(() => this.dismiss(id), dismissAfter);
        this._timers.set(id, timer);
      }
    },
  },
});
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm --filter @vulse/admin test -- toasts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/stores/toasts.ts packages/admin/src/stores/__tests__/toasts.test.ts
git commit -m "feat(admin): toast notifications store"
```

---

## Task 2: Toasts component

**Files:**
- Create: `packages/admin/src/components/Toasts.vue`
- Modify: `packages/admin/src/App.vue` (mount only — sidebar work is Task 3)

- [ ] **Step 1: Create the component**

Create `packages/admin/src/components/Toasts.vue`:

```vue
<script setup lang="ts">
import { useToastsStore } from '../stores/toasts.js';

const toasts = useToastsStore();

const colorFor = (kind: 'success' | 'error' | 'info') => {
  if (kind === 'success') return 'border-green-200 bg-green-50 text-green-800';
  if (kind === 'error') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-zinc-200 bg-white text-zinc-800';
};
</script>

<template>
  <div class="fixed right-4 bottom-4 z-50 flex flex-col gap-2" data-testid="toasts">
    <button
      v-for="t in toasts.list"
      :key="t.id"
      type="button"
      class="min-w-[14rem] max-w-sm rounded border px-3 py-2 text-left text-sm shadow-sm transition hover:shadow"
      :class="colorFor(t.kind)"
      :data-testid="`toast-${t.kind}`"
      @click="toasts.dismiss(t.id)"
    >
      {{ t.message }}
    </button>
  </div>
</template>
```

- [ ] **Step 2: Mount the component in `App.vue`**

In `packages/admin/src/App.vue`, add the import at the top of the
`<script setup>` block (alongside the existing imports):

```ts
import Toasts from './components/Toasts.vue';
```

Then add `<Toasts />` as the last child of the outer `<div class="flex h-full">`
in the template, immediately before its closing `</div>`:

```vue
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
    <Toasts />
  </div>
</template>
```

(Do not touch the sidebar in this task — Task 3 owns it.)

- [ ] **Step 3: Verify the admin package still typechecks and tests pass**

```bash
pnpm --filter @vulse/admin typecheck
pnpm --filter @vulse/admin test
```

Expected: typecheck clean, all existing admin tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/components/Toasts.vue packages/admin/src/App.vue
git commit -m "feat(admin): mount global Toasts container"
```

---

## Task 3: Sidebar — Settings group with collapsible Schema

**Files:**
- Modify: `packages/admin/src/App.vue`

- [ ] **Step 1: Replace the sidebar markup and script**

Rewrite `packages/admin/src/App.vue`. The full new file:

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import Toasts from './components/Toasts.vue';
import { useBlueprintsStore } from './stores/blueprints.js';

const store = useBlueprintsStore();
const router = useRouter();

const SCHEMA_OPEN_KEY = 'vulse.sidebar.schema.open';
const schemaOpen = ref(false);

onMounted(async () => {
  try {
    schemaOpen.value = localStorage.getItem(SCHEMA_OPEN_KEY) === '1';
  } catch {
    // localStorage unavailable (SSR, sandboxed iframes) — leave default.
  }
  await store.hydrate();
  const first = store.list[0];
  if (first && router.currentRoute.value.path === '/loading') {
    router.replace(`/collections/${first.handle}`);
  }
});

watch(schemaOpen, (v) => {
  try {
    localStorage.setItem(SCHEMA_OPEN_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
});
</script>

<template>
  <div class="flex h-full">
    <aside class="w-[var(--vulse-sidebar-width)] border-r border-zinc-200 bg-white">
      <div class="px-4 py-3 font-semibold tracking-tight">Vulse</div>
      <nav class="px-2">
        <div class="px-2 pt-2 text-xs uppercase tracking-wide text-zinc-500">Collections</div>
        <RouterLink
          v-for="bp in store.list"
          :key="`coll-${bp.handle}`"
          :to="`/collections/${bp.handle}`"
          class="block rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
          active-class="bg-zinc-100 font-medium"
          :data-testid="`nav-${bp.handle}`"
        >
          {{ bp.label }}
        </RouterLink>

        <div class="px-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">Settings</div>
        <button
          type="button"
          class="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100"
          data-testid="settings-schema-toggle"
          :aria-expanded="schemaOpen"
          @click="schemaOpen = !schemaOpen"
        >
          <span class="inline-block w-3 text-zinc-400">{{ schemaOpen ? '▾' : '▸' }}</span>
          <span>Schema</span>
        </button>
        <div v-if="schemaOpen" class="ml-4" data-testid="settings-schema-children">
          <RouterLink
            v-for="bp in store.list"
            :key="`schema-${bp.handle}`"
            :to="`/schema/${bp.handle}`"
            class="block rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
            active-class="bg-zinc-100 font-medium"
            :data-testid="`schema-nav-${bp.handle}`"
          >
            {{ bp.label }}
          </RouterLink>
          <RouterLink
            to="/schema/new"
            class="block rounded px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
            active-class="bg-zinc-100 font-medium"
            data-testid="schema-nav-new"
          >
            + New collection
          </RouterLink>
        </div>
      </nav>
    </aside>
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
    <Toasts />
  </div>
</template>
```

- [ ] **Step 2: Verify typecheck and run admin tests**

```bash
pnpm --filter @vulse/admin typecheck
pnpm --filter @vulse/admin test
```

Expected: typecheck clean; existing tests still pass (they don't depend on
the old sidebar structure).

- [ ] **Step 3: Smoke-check in the browser (optional but recommended)**

Run `pnpm dev` from `apps/dev`, open the admin, and confirm:
- A `SETTINGS` heading appears below `COLLECTIONS`.
- `▸ Schema` is collapsed on first load.
- Clicking toggles to `▾ Schema` and reveals blueprint links + `+ New collection`.
- Reloading the page preserves the open/closed state.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/App.vue
git commit -m "feat(admin): collapsible Schema under Settings sidebar group"
```

---

## Task 4: Label-first form with computed handle

**Files:**
- Modify: `packages/admin/src/pages/BlueprintEditor.vue`
- Modify: `packages/admin/src/pages/__tests__/BlueprintEditor.test.ts`

- [ ] **Step 1: Add the failing tests**

Append these tests inside the existing `describe('BlueprintEditor', ...)` in
`packages/admin/src/pages/__tests__/BlueprintEditor.test.ts`:

```ts
  it('auto-slugifies handle from label in create mode', async () => {
    const w = mountEditor(null);
    await flushPromises();
    await w.find('[data-testid="blueprint-label"]').setValue('My Cool Pages');
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'my-cool-pages',
    );
  });

  it('locks the handle once the user clicks Edit, and stops auto-syncing', async () => {
    const w = mountEditor(null);
    await flushPromises();
    await w.find('[data-testid="blueprint-label"]').setValue('Pages');
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'pages',
    );
    await w.find('[data-testid="handle-edit"]').trigger('click');
    await w.find('[data-testid="blueprint-handle"]').setValue('my-pages');
    await w.find('[data-testid="blueprint-label"]').setValue('Pages Renamed');
    // Handle stays at the user-edited value.
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'my-pages',
    );
  });

  it('reset returns handle to the slugified label', async () => {
    const w = mountEditor(null);
    await flushPromises();
    await w.find('[data-testid="blueprint-label"]').setValue('Pages');
    await w.find('[data-testid="handle-edit"]').trigger('click');
    await w.find('[data-testid="blueprint-handle"]').setValue('something-else');
    await w.find('[data-testid="handle-reset"]').trigger('click');
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'pages',
    );
    // After reset, typing into Label should sync again.
    await w.find('[data-testid="blueprint-label"]').setValue('Posts');
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'posts',
    );
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm --filter @vulse/admin test -- BlueprintEditor
```

Expected: FAIL — current editor doesn't slugify and lacks `handle-edit` /
`handle-reset` controls.

- [ ] **Step 3: Implement label-first + computed handle**

In `packages/admin/src/pages/BlueprintEditor.vue`:

**3a.** Add `slugify` and `handleLocked` near the other refs (after the
existing `errors` declaration):

```ts
const handleLocked = ref(false);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '');
}

watch(label, (v) => {
  if (isCreate.value && !handleLocked.value) {
    handle.value = slugify(v);
  }
});

function unlockHandle() {
  handleLocked.value = true;
}

function resetHandle() {
  handleLocked.value = false;
  handle.value = slugify(label.value);
}
```

**3b.** Update `load()` so loading an existing blueprint sets the lock
appropriately (existing blueprints have a fixed handle that's already in
sync with their stored label; treat them as locked so opening Edit mode
doesn't try to re-slugify):

Replace the body of `load()` with:

```ts
async function load() {
  for (const k of Object.keys(errors)) delete errors[k];
  fields.splice(0, fields.length);
  if (props.handle === null) {
    handle.value = '';
    label.value = '';
    singleton.value = false;
    handleLocked.value = false;
    return;
  }
  const bp = await api.getBlueprint(props.handle);
  handle.value = bp.handle;
  label.value = bp.label;
  singleton.value = bp.singleton;
  handleLocked.value = true;
  for (const f of bp.fields) {
    fields.push({ ...f, previousName: f.name });
  }
}
```

**3c.** Replace the details-card markup so Label comes first and Handle is
read-only with Edit/Reset controls in create mode. Find the existing block:

```vue
      <div class="space-y-3 rounded border border-zinc-200 bg-white p-4">
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Handle</span>
          ...
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Label</span>
          ...
        </label>
        <label class="flex items-center gap-2">
          <input v-model="singleton" ... />
          ...
        </label>
      </div>
```

…and replace the entire `<div class="space-y-3 rounded border ...">` block
with:

```vue
      <div class="space-y-3 rounded border border-zinc-200 bg-white p-4">
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Label</span>
          <input
            v-model="label"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            data-testid="blueprint-label"
          />
          <span v-if="errors['label']" class="mt-1 block text-xs text-red-600">{{ errors['label'] }}</span>
        </label>
        <div>
          <div class="flex items-baseline justify-between">
            <span class="block text-sm font-medium text-zinc-700">Handle</span>
            <div v-if="isCreate" class="flex gap-3 text-xs">
              <button
                v-if="!handleLocked"
                type="button"
                class="text-zinc-500 hover:text-zinc-900"
                data-testid="handle-edit"
                @click="unlockHandle"
              >
                Edit
              </button>
              <button
                v-else
                type="button"
                class="text-zinc-500 hover:text-zinc-900"
                data-testid="handle-reset"
                @click="resetHandle"
              >
                Reset
              </button>
            </div>
          </div>
          <input
            v-model="handle"
            :readonly="!isCreate || !handleLocked"
            :disabled="!isCreate"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm read-only:bg-zinc-50 disabled:bg-zinc-100"
            data-testid="blueprint-handle"
          />
          <span v-if="errors['handle']" class="mt-1 block text-xs text-red-600">{{ errors['handle'] }}</span>
        </div>
        <label class="flex items-center gap-2">
          <input
            v-model="singleton"
            type="checkbox"
            class="rounded border-zinc-300"
            data-testid="blueprint-singleton"
          />
          <span class="text-sm font-medium text-zinc-700">Singleton (only one entry)</span>
        </label>
      </div>
```

(`watch` must be in the imports from `vue`. The file already imports
`computed, onMounted, reactive, ref, watch` — confirm `watch` is included
and add it to the import if not.)

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm --filter @vulse/admin test -- BlueprintEditor
```

Expected: PASS — all existing tests plus the three new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/pages/BlueprintEditor.vue packages/admin/src/pages/__tests__/BlueprintEditor.test.ts
git commit -m "feat(admin): label-first blueprint form with computed handle"
```

---

## Task 5: Empty-fields empty state + disabled Save

**Files:**
- Modify: `packages/admin/src/pages/BlueprintEditor.vue`
- Modify: `packages/admin/src/pages/__tests__/BlueprintEditor.test.ts`

- [ ] **Step 1: Add the failing tests**

Append inside the existing `describe('BlueprintEditor', ...)`:

```ts
  it('shows an empty-state card and disables Save when there are no fields', async () => {
    const w = mountEditor(null);
    await flushPromises();
    expect(w.find('[data-testid="fields-empty-state"]').exists()).toBe(true);
    expect(
      (w.find('[data-testid="blueprint-save"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
    // Adding a field removes the empty state and enables Save.
    await w.find('[data-testid="add-field"]').trigger('click');
    expect(w.find('[data-testid="fields-empty-state"]').exists()).toBe(false);
    expect(
      (w.find('[data-testid="blueprint-save"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm --filter @vulse/admin test -- BlueprintEditor
```

Expected: FAIL — empty-state element missing; Save not disabled when zero fields.

- [ ] **Step 3: Implement the empty state and disabled Save**

In `packages/admin/src/pages/BlueprintEditor.vue`:

**3a.** Inside the Fields section, replace the field-card loop with an
empty-state branch + the existing loop. Find:

```vue
        <div
          v-for="(f, i) in fields"
          :key="i"
          class="rounded border border-zinc-200 bg-white"
          :data-testid="`field-card-${f.name || `new-${i}`}`"
        >
```

…and immediately before it, insert the empty-state block:

```vue
        <div
          v-if="fields.length === 0"
          class="rounded border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm text-zinc-600"
          data-testid="fields-empty-state"
        >
          <p class="font-medium text-zinc-700">No fields yet.</p>
          <p class="mt-1">
            Add at least one field to define what entries in this collection look like.
          </p>
          <button
            type="button"
            class="mt-3 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            data-testid="fields-empty-add"
            @click="addField"
          >
            + Add field
          </button>
        </div>
```

**3b.** Update the Save button to disable when `fields.length === 0`. Find:

```vue
        <button
          type="submit"
          class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          :disabled="saving"
          data-testid="blueprint-save"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
```

…and replace it with:

```vue
        <button
          type="submit"
          class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          :disabled="saving || fields.length === 0"
          :title="fields.length === 0 ? 'Add at least one field before saving.' : undefined"
          data-testid="blueprint-save"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
```

**3c.** Suppress the misleading "Some fields are invalid; see inline messages."
banner when there are zero fields. Find the `submitError.value = 'Some fields are invalid; see inline messages.';`
line inside `save()` and replace the surrounding `if` block:

```ts
    if (e.response?.error === 'validation' && e.response.issues) {
      for (const issue of e.response.issues) {
        const key = issue.path.join('.');
        errors[key] = issue.message;
      }
      submitError.value = 'Some fields are invalid; see inline messages.';
    } else {
```

…with:

```ts
    if (e.response?.error === 'validation' && e.response.issues) {
      for (const issue of e.response.issues) {
        const key = issue.path.join('.');
        errors[key] = issue.message;
      }
      submitError.value =
        fields.length === 0 ? null : 'Some fields are invalid; see inline messages.';
    } else {
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
pnpm --filter @vulse/admin test -- BlueprintEditor
```

Expected: PASS — all existing tests plus the new empty-state test.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/pages/BlueprintEditor.vue packages/admin/src/pages/__tests__/BlueprintEditor.test.ts
git commit -m "feat(admin): empty-state guidance when blueprint has no fields"
```

---

## Task 6: Wire toasts into BlueprintEditor + CollectionEntry

**Files:**
- Modify: `packages/admin/src/pages/BlueprintEditor.vue`
- Modify: `packages/admin/src/pages/CollectionEntry.vue`
- Modify: `packages/admin/src/pages/__tests__/BlueprintEditor.test.ts`

- [ ] **Step 1: Add the failing test for BlueprintEditor save toast**

Append inside the existing `describe('BlueprintEditor', ...)`:

```ts
  it('emits a success toast on save', async () => {
    vi.spyOn(client.api, 'updateBlueprint').mockResolvedValue({
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [],
    });
    const w = mountEditor('posts');
    await flushPromises();
    // Editor is in edit mode with 2 fields preloaded — Save is enabled.
    await w.find('form').trigger('submit');
    await flushPromises();

    // Inspect the toasts store directly to avoid coupling to <Toasts /> markup,
    // which is not mounted in this isolated component test.
    const { useToastsStore } = await import('../../stores/toasts.js');
    const toasts = useToastsStore();
    expect(toasts.list.map((t) => ({ kind: t.kind, message: t.message }))).toEqual([
      { kind: 'success', message: 'Schema saved' },
    ]);
  });
```

- [ ] **Step 2: Run the tests and verify the new one fails**

```bash
pnpm --filter @vulse/admin test -- BlueprintEditor
```

Expected: FAIL — `toasts.list` is empty because no toast is pushed yet.

- [ ] **Step 3: Wire toasts into BlueprintEditor**

In `packages/admin/src/pages/BlueprintEditor.vue`:

**3a.** Add the import alongside the existing imports at the top of
`<script setup>`:

```ts
import { useToastsStore } from '../stores/toasts.js';
```

**3b.** Add the store handle near the other store usage (just below
`const store = useBlueprintsStore();`):

```ts
const toasts = useToastsStore();
```

**3c.** Update `save()` to push toasts. Find:

```ts
    if (isCreate.value) {
      await api.createBlueprint(payload as unknown as BlueprintMeta);
    } else {
      await api.updateBlueprint(props.handle!, payload as never);
    }
    await store.refresh();
    router.push(`/schema/${handle.value}`);
```

…and replace with:

```ts
    if (isCreate.value) {
      await api.createBlueprint(payload as unknown as BlueprintMeta);
    } else {
      await api.updateBlueprint(props.handle!, payload as never);
    }
    await store.refresh();
    toasts.success('Schema saved');
    router.push(`/schema/${handle.value}`);
```

In the `catch` block, find:

```ts
    } else {
      submitError.value = e.response?.message ?? 'Failed to save';
    }
```

…and replace with:

```ts
    } else {
      const msg = e.response?.message ?? 'Failed to save';
      submitError.value = msg;
      toasts.error(msg);
    }
```

**3d.** Update `destroy()` to push a toast on success. Find:

```ts
  await api.deleteBlueprint(props.handle);
  await store.refresh();
  router.push('/schema');
```

…and replace with:

```ts
  await api.deleteBlueprint(props.handle);
  await store.refresh();
  toasts.success('Blueprint deleted');
  router.push('/schema');
```

- [ ] **Step 4: Wire toasts into CollectionEntry**

In `packages/admin/src/pages/CollectionEntry.vue`:

**4a.** Add the import:

```ts
import { useToastsStore } from '../stores/toasts.js';
```

**4b.** Add the store handle near the other store usage:

```ts
const toasts = useToastsStore();
```

**4c.** Update `save()`. Find:

```ts
    const entry = props.id
      ? await api.update(props.handle, props.id, { ...state })
      : await api.create(props.handle, { ...state });
    if (!props.id) router.replace(`/collections/${props.handle}/${entry.id}`);
```

…and replace with:

```ts
    const entry = props.id
      ? await api.update(props.handle, props.id, { ...state })
      : await api.create(props.handle, { ...state });
    toasts.success('Entry saved');
    if (!props.id) router.replace(`/collections/${props.handle}/${entry.id}`);
```

In the `catch` block, find:

```ts
    } else {
      submitError.value = e.response?.message ?? 'Failed to save';
    }
```

…and replace with:

```ts
    } else {
      const msg = e.response?.message ?? 'Failed to save';
      submitError.value = msg;
      toasts.error(msg);
    }
```

- [ ] **Step 5: Run the tests and verify everything passes**

```bash
pnpm --filter @vulse/admin test
pnpm --filter @vulse/admin typecheck
```

Expected: all admin tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/pages/BlueprintEditor.vue packages/admin/src/pages/CollectionEntry.vue packages/admin/src/pages/__tests__/BlueprintEditor.test.ts
git commit -m "feat(admin): toast notifications for blueprint and entry saves"
```

---

## Final verification

- [ ] **Run full workspace checks**

```bash
pnpm -r typecheck
pnpm -r test
pnpm biome check .
```

Expected: typecheck clean across all packages, all tests pass, Biome clean.

- [ ] **Manual smoke check in the browser**

Run `pnpm dev` from `apps/dev`. Verify:

1. Sidebar shows Collections + Settings groups. Settings → Schema starts
   collapsed; toggling persists across reloads.
2. Creating a new collection: typing in Label populates Handle live.
   Clicking Edit unlocks Handle; clicking Reset returns it to the
   slugified label and re-enables auto-sync.
3. With zero fields, the editor shows the empty-state card and Save is
   disabled. Adding a field enables Save.
4. Saving a blueprint shows a green "Schema saved" toast bottom-right;
   it auto-dismisses after ~4s.
5. Saving an entry shows a green "Entry saved" toast.
6. Forcing an error (e.g. delete the dev DB while saving) shows a red
   error toast that stays until clicked.
