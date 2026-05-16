# Schema UX improvements — Design

Date: 2026-05-16
Status: Approved

## Problem

The blueprint editor and surrounding navigation have rough edges that surfaced
the first time a user tried to create a collection from scratch:

1. **Handle-first ordering is unfriendly.** The Handle field comes before Label
   and demands a machine name (`/^[a-z][a-z0-9_-]*$/`) before the user has even
   named the collection. The error "Invalid string: must match pattern
   /^[a-z][a-z0-9_-]*$/" is shown to humans.
2. **Saving an empty schema produces a confusing error.** Hitting Save with no
   fields surfaces "Some fields are invalid; see inline messages." — but there
   are no fields to inline a message under.
3. **Schema clutters the sidebar.** The Schema group lives at the top level
   alongside Collections, so it appears as prominent as day-to-day content even
   though it's a configuration concern.
4. **No feedback on save.** Saving a blueprint or an entry succeeds silently,
   leaving the user unsure whether anything happened.

## Goals

- Make the New collection form readable to a human who has never seen Vulse.
- Replace the misleading empty-fields error with guidance.
- Reframe Schema as a setting, collapsed by default.
- Add a single notification primitive used by both schema and entry saves.

## Non-goals

- Renaming `handle` in the database or API. The change is presentational; the
  Handle still ends up in the same JSON column with the same constraints.
- Field-level toasts (e.g. one per inline error). Field validation stays
  inline; toasts are for top-level operations.
- A general settings page. "Settings" is a sidebar group only; clicking it does
  not navigate anywhere on its own.

## Design

### 1. Sidebar reorganization

`packages/admin/src/App.vue` gains a third sidebar group, **Settings**, placed
below Collections. The existing top-level Schema group is removed.

Inside Settings, a single collapsible row labeled **Schema** with a chevron
(▸ when collapsed, ▾ when open). The row is a button, not a router-link — it
toggles open state. When open it reveals:

- One row per blueprint, linking to `/schema/<handle>` (same routes as today).
- A `+ New collection` row at the bottom, linking to `/schema/new`.

Open state persists in `localStorage` under the key
`vulse.sidebar.schema.open` with values `"1"` or `"0"`. Default is collapsed
(`"0"`). Read on mount, written on toggle.

```
COLLECTIONS
  Authors
  Posts
  E-learning

SETTINGS
  ▸ Schema             ← collapsed by default
      Authors          ← when expanded
      Posts
      E-learning
      + New collection
```

No deep-linking magic — visiting `/schema/posts` directly does not auto-expand
the group. The user can still get there via the URL; the sidebar reflects the
user's last toggle.

### 2. Label-first form with computed handle

In `packages/admin/src/pages/BlueprintEditor.vue`, the top "details" card is
reordered:

1. **Label** (text input, first)
2. **Handle** (read-only by default in create mode, with an inline "Edit" link)
3. **Singleton** checkbox

A small `slugify` helper inside the component converts Label → Handle:

```ts
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]+/g, '-')   // non-alnum to dash
    .replace(/^-+|-+$/g, '')          // trim dashes
    .replace(/^[^a-z]+/, '');          // first char must be a letter
}
```

A `handleLocked` ref tracks whether the user has manually overridden the
handle. On create mode:

- Initially `handleLocked = false`; the Handle input is `readonly` and shows
  `slugify(label)` live.
- An "Edit" text-button on the right of the Handle row sets `handleLocked = true`
  and makes the input editable. Once locked, the auto-sync stops; the user
  owns the value.
- A small "Reset" link appears once locked; clicking it sets the handle back
  to `slugify(label)` and clears the lock.

On edit mode the handle is immutable (existing behavior); the Edit/Reset
controls are not shown.

### 3. Empty-fields empty state

In the Fields section, when `fields.length === 0`:

- Suppress the top-level "Some fields are invalid; see inline messages." error
  even if validation fails (it is misleading when there are zero fields).
- Render an empty-state card in place of the field list:

  > **No fields yet.** Add at least one field to define what entries in this
  > collection look like.
  >
  > [+ Add field]

- The Save button is disabled when `fields.length === 0`. Hover title:
  "Add at least one field before saving."

The empty-state card uses the same border/background as a field card to feel
like a placeholder, not an error.

### 4. Toast notifications

A small Pinia store + Vue component pair, with no external dependencies.

**`packages/admin/src/stores/toasts.ts`** — Pinia store:

```ts
export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
```

Actions:

- `success(message: string)` — push a `success` toast, auto-dismiss in 4000ms.
- `error(message: string)` — push an `error` toast, no auto-dismiss.
- `info(message: string)` — push an `info` toast, auto-dismiss in 4000ms.
- `dismiss(id: number)` — remove by id.

A monotonic counter generates ids. Auto-dismiss is implemented inside the
store via `setTimeout`; the timer is cleared if the toast is dismissed early.

**`packages/admin/src/components/Toasts.vue`** — fixed-position stack:

- Positioned `fixed bottom-4 right-4 z-50`.
- Stacks vertically with a 2-unit gap; newest at the bottom.
- Each toast: rounded card, kind-specific color (success: green, error: red,
  info: zinc), a short message, and an implicit click-to-dismiss on the whole
  card.
- Mounted once in `App.vue`.

**Wiring:**

- `BlueprintEditor.save()` — on success: `toasts.success('Schema saved')`. On
  non-validation error: `toasts.error(message)` instead of the inline
  `submitError` block. Validation errors continue to populate the inline
  `errors` map.
- `BlueprintEditor.destroy()` — `toasts.success('Blueprint deleted')`.
- `CollectionEntry.vue` save flow — `toasts.success('Entry saved')` /
  `toasts.error(message)`.

### Files touched

- `packages/admin/src/App.vue` — sidebar restructure, mount `<Toasts />`.
- `packages/admin/src/pages/BlueprintEditor.vue` — label-first, slugified
  handle, empty-state card, save disabled when no fields, toasts on save and
  delete.
- `packages/admin/src/pages/CollectionEntry.vue` — toasts on save success/error.
- `packages/admin/src/stores/toasts.ts` — new Pinia store.
- `packages/admin/src/components/Toasts.vue` — new component.
- `packages/admin/src/pages/__tests__/BlueprintEditor.test.ts` — update for
  label-first ordering and empty-state behavior.
- `packages/admin/src/stores/__tests__/toasts.test.ts` — new test for the
  store's auto-dismiss and dismiss-by-id behavior.

### Out of scope

- Toast queue limits (e.g. max 5 visible). One save = one toast in practice;
  cap is unnecessary in the dev CMS today.
- Settings sub-pages beyond Schema. Future settings (revisions, users,
  navigation) can join the same group later without changing this design.
- Migrating the existing `submitError` banner away from validation paths;
  it stays for inline-validation summaries only.
