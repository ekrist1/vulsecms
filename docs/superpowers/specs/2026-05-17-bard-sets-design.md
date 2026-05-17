# Bard sets — Design

Date: 2026-05-17
Status: Approved

## Problem

Authors writing rich-text content in Vulse can use a handful of fixed
custom blocks (callout, accordion, iframe, video) but cannot define their
own. Statamic-style "Bard sets" let teams create reusable, schema-driven
blocks — Quote-with-attribution, Image gallery, Pull-quote, Newsletter
CTA — and drop them inline into prose. Vulse already has the building
blocks (TipTap custom nodes, the Replicator nested-field pattern, the
component-map renderer), so this is a feature of composition, not
invention.

## Goals

- A super user can define **sets** in a global library (handle + label +
  ordered nested fields).
- Each `blocks` field can opt into a subset of sets by handle.
- Authors insert a set from a toolbar dropdown into the editor; it
  renders as an inline expand/collapse card with `<FieldRenderer>` per
  nested field.
- Server-side validation: on entry save, every `vulseSet` node's `data`
  is validated against the set's compiled Zod schema. Non-set nodes pass
  through (matches today's `blocks` posture).
- The framework-agnostic and Vue renderers can both dispatch a
  `vulseSet` node to a consumer-supplied component map by set name.

## Non-goals (v1)

- Per-blueprint inline set definitions (Statamic's per-field sets). The
  library is global; blocks fields opt in by handle.
- Nested sets (a set field whose UI is `replicator` OR `blocks`-with-sets).
  Forbidden at the schema level.
- `previousName`-style field renames within a set. Saved entries that
  reference a renamed field fail validation; users handle this with a
  one-shot rewrite (acceptable in active dev).
- Per-set permissions / group-level gating of which sets a user can
  insert.
- "Convert paragraph to set" or similar prose-aware transforms.
- Drag-to-reorder beyond TipTap's built-in `draggable: true`.

## Architecture

```
@vulse/core
├── blueprints/definition.ts        EXTEND blocks UI variant with sets?: string[]
├── sets/                           NEW
│   ├── definition.ts                 SetDefinition schema (Zod)
│   ├── compile.ts                    compileSet → ZodObject over data
│   ├── service.ts                    create/list/get/update/delete
│   ├── load.ts                       loadSets({adapter}) → Map<handle, CompiledSet>
│   ├── validate-tree.ts              walkPM(doc, registry) → Zod issues for vulseSet nodes
│   └── events.ts                     setsEvents emitter (mirrors blueprintEvents)
├── content/service.ts              MODIFY validate() to invoke set-tree validation
├── blueprints/compile.ts           MODIFY blocks compile: when sets present, attach superRefine
└── http/api.ts                     MODIFY mount setsRoute; live-rebuild on setsEvents

@vulse/db
└── migrations/009_sets.sql         NEW

@vulse/admin
├── stores/sets.ts                  NEW Pinia store (mirrors blueprints store)
├── api/client.ts                   EXTEND with set CRUD methods + SetDTO type
├── pages/SetList.vue               NEW
├── pages/SetEditor.vue             NEW (reuses BlueprintEditor field builder)
├── pages/BlueprintEditor.vue       MODIFY blocks field: "Available sets" chip picker
├── components/fields/
│   ├── BlocksField.vue              MODIFY toolbar: "+ Insert set" dropdown
│   ├── vulse-set-extension.ts       NEW TipTap node
│   └── VulseSetNodeView.vue         NEW inline card with FieldRenderer
├── router.ts                       MODIFY /settings/sets routes (super)
└── App.vue                         MODIFY sidebar: Sets link inside Schema group

@vulse/renderer
├── BlockRenderer.vue               MODIFY default handler dispatches to `set:<name>`
└── html.ts                         MODIFY default handler dispatches to `set:<name>`
```

## Data model

### Migration `009_sets.sql`

```sql
CREATE TABLE sets (
  handle      TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  definition  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Set handles are globally unique. The handle regex (`/^[a-z][a-z0-9_-]*$/`)
matches the blueprint handle regex.

### `SetDefinition` (Zod)

```ts
// packages/core/src/sets/definition.ts

export const SetDefinitionSchema = z.object({
  handle: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().min(1),
  fields: z.array(NestedFieldDefinitionSchema).min(1),
});

export type SetDefinition = z.infer<typeof SetDefinitionSchema>;
```

`NestedFieldDefinitionSchema` is reused from
`packages/core/src/blueprints/definition.ts`. Its `ui` field is
`NonReplicatorFieldUiSchema`, which already excludes replicators inside
sets. A `blocks` field nested inside a set is allowed (the inner
`blocks` can carry its own `sets: [...]` — that's a finite tree of
schema choices, not unbounded recursion at runtime since each set is
independently registered in the global library and looked up by name).

### Blocks field extension

The existing blocks UI variant in
`packages/core/src/blueprints/definition.ts`:

```ts
const blocksFieldUiSchema = z.object({ kind: z.literal('blocks') });
```

becomes:

```ts
const blocksFieldUiSchema = z.object({
  kind: z.literal('blocks'),
  sets: z.array(z.string().regex(/^[a-z][a-z0-9_-]*$/)).optional(),
});
```

When `sets` is omitted (existing blueprints), behavior is unchanged. No
data migration on entries.

### Wire shape of a set node in entry content

```json
{
  "type": "vulseSet",
  "attrs": {
    "set": "quote",
    "data": { "quote": "Lorem ipsum dolor", "author": "Anna Smith" }
  }
}
```

`vulseSet` is a TipTap atom (`atom: true`) — no `content` children. All
field values live in `attrs.data`.

## Compile + validate

### `compileSet`

```ts
// packages/core/src/sets/compile.ts

export interface CompiledSet {
  definition: SetDefinition;
  schema: z.ZodObject<z.ZodRawShape>;
}

export function compileSet(def: SetDefinition): CompiledSet {
  // Reuse compileFieldObject from blueprints/compile.ts to build the
  // ZodObject for the set's `data` payload from its NestedFieldDefinitions.
  return { definition: def, schema: compileFieldObject(def.fields) };
}
```

### `loadSets`

```ts
// packages/core/src/sets/load.ts

export async function loadSets({ adapter }: { adapter: DatabaseAdapter })
  : Promise<Map<string, CompiledSet>> {
  const rows = await adapter.query<{ handle: string; definition: string }>(
    `SELECT handle, definition FROM sets ORDER BY created_at ASC`,
  );
  const map = new Map<string, CompiledSet>();
  for (const r of rows) {
    map.set(r.handle, compileSet(SetDefinitionSchema.parse(JSON.parse(r.definition))));
  }
  return map;
}
```

### `validate-tree`

```ts
// packages/core/src/sets/validate-tree.ts

export function validateSetNodes(
  doc: unknown,
  fieldPath: (string | number)[],
  sets: Map<string, CompiledSet>,
  ctx: z.RefinementCtx,
): void {
  if (!isProseMirrorNode(doc)) return;
  walk(doc, fieldPath);

  function walk(node: BlockNode, path: (string | number)[]): void {
    if (node.type === 'vulseSet') {
      const handle = (node.attrs as { set?: string } | undefined)?.set;
      const data = (node.attrs as { data?: unknown } | undefined)?.data ?? {};
      const compiled = handle ? sets.get(handle) : undefined;
      if (!compiled) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'set'],
          message: `unknown set: ${handle ?? '(empty)'}`,
        });
        return;
      }
      const parsed = compiled.schema.safeParse(data);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ ...issue, path: [...path, 'data', ...issue.path] });
        }
      }
      return;
    }
    if (Array.isArray(node.content)) {
      node.content.forEach((c, i) => walk(c, [...path, 'content', i]));
    }
  }
}
```

The function takes a `RefinementCtx` so it integrates with `superRefine`.

### Blocks compile hook

In `packages/core/src/blueprints/compile.ts`, when compiling a blocks
field whose `ui.sets` is non-empty:

```ts
// Pseudocode at the call site for `kind === 'blocks'`:
if (field.ui.kind === 'blocks' && field.ui.sets?.length) {
  const setsRegistry = ctx.sets;        // passed into compileBlueprint(def, {sets})
  return z.any().superRefine((value, refinementCtx) => {
    validateSetNodes(value, [], setsRegistry, refinementCtx);
  });
}
return z.any();
```

`compileBlueprint` gains a second arg `{ sets: Map<string, CompiledSet> }`.
`loadBlueprints` is updated to thread the sets registry through.

### Content service integration

Already routes through `blueprint.schema.safeParse(input)` (see
`packages/core/src/content/service.ts` `validate()`). No change needed —
the blocks field's compiled schema now refines into set validation.

## TipTap node

### `vulse-set-extension.ts`

```ts
import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import VulseSetNodeView from './VulseSetNodeView.vue';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    vulseSet: {
      insertVulseSet: (setHandle: string) => ReturnType;
    };
  }
}

export const VulseSetExtension = Node.create({
  name: 'vulseSet',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      set: { default: null, parseHTML: (e) => e.getAttribute('data-vulse-set') },
      data: {
        default: {},
        parseHTML: (e) => JSON.parse(e.getAttribute('data-vulse-data') ?? '{}'),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-vulse-set]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-vulse-set': node.attrs.set,
      'data-vulse-data': JSON.stringify(node.attrs.data),
    })];
  },
  addNodeView() {
    return VueNodeViewRenderer(VulseSetNodeView);
  },
  addCommands() {
    return {
      insertVulseSet: (setHandle: string) => ({ commands }) =>
        commands.insertContent({
          type: 'vulseSet',
          attrs: { set: setHandle, data: {} },
        }),
    };
  },
});
```

Registered in `blocks-editor-extensions.ts` alongside the existing
custom nodes.

### `VulseSetNodeView.vue`

Props: `node`, `updateAttributes`, `deleteNode` (TipTap node-view
contract).

State:
- `expanded: ref(false)` — toggled by header click.
- Looks up set definition via `useSetsStore().get(node.attrs.set)`. If
  missing → renders a "missing set: foo" placeholder card, still
  draggable + removable.

Template (collapsed):
```
[▸ <set.label>]  <one-line summary of first text-ish field>     [Remove] [Duplicate]
```

Template (expanded):
```
[▾ <set.label>]
  <FieldRenderer> for each field in set.definition.fields:
     meta = field, modelValue = data[field.name], update = (v) => …
  [Remove] [Duplicate]
```

On nested field change → `updateAttributes({ data: { ...node.attrs.data, [fieldName]: value } })`.
Duplicate inserts a second node with identical attrs at the current
position+1.

## Editor UX in `BlocksField.vue`

The existing toolbar gains a dropdown when the current blocks field has
`field.ui.sets?.length`:

```vue
<select @change="insertSet(($event.target as HTMLSelectElement).value)">
  <option value="" disabled selected>+ Insert set</option>
  <option v-for="handle in availableSetHandles" :key="handle" :value="handle">
    {{ setsStore.get(handle)?.label ?? handle }}
  </option>
</select>
```

`insertSet(handle)` calls `editor.chain().focus().insertVulseSet(handle).run()`.

Where `availableSetHandles = field.ui.sets ?? []` filtered to set handles
that currently exist in `setsStore`.

## Renderer dispatch

In `packages/renderer/src/defaults.ts`, add:

```ts
import VulseSet from './components/VulseSet.vue';
// ...
export const defaultComponents: BlockComponentMap = {
  // ... existing entries ...
  vulseSet: VulseSet,
};
```

`VulseSet.vue` reads `node.attrs.set` and looks up `components[`set:${node.attrs.set}`]`
on the components map. If found, renders it with `data` bound. If
missing, renders a small `<div data-vulse-missing-set="…">` placeholder
(non-fatal — site still renders).

The framework-agnostic `renderBlocksHtml` adds the same dispatch with
function-handler signatures: `setComponents: Record<string, (data) => string>`.
Caller passes `components: { 'set:quote': (data) => `<blockquote>…` }`.

## Admin UI

### Routes (super-only)

```ts
{ path: '/settings/sets', component: SetList },
{ path: '/settings/sets/new', component: SetEditor, props: () => ({ handle: null }) },
{ path: '/settings/sets/:handle', component: SetEditor, props: true },
```

### `SetList.vue`

Table: handle, label, # fields, # blueprints using it (computed by
walking blueprints store; show "—" until that's wired). "+ New set"
button, edit link, delete with confirm.

### `SetEditor.vue`

Mirrors `BlueprintEditor.vue` minus the singleton/protected concerns and
field-rename logic. Reuses the existing nested-field card UI for adding
text/textarea/blocks/date/boolean/select/relationship fields with
validation editors. Saves to `POST /api/sets` (create) or
`PATCH /api/sets/:handle` (update).

### `BlueprintEditor.vue` modification

For each field of `kind: 'blocks'`, show a small "Available sets" chip
picker populated from `setsStore.list`. Multi-select via checkboxes.
Saving sends `sets: [handle, ...]` in the field's `ui` definition.

### Sidebar (App.vue)

Inside the Settings → Schema collapsible group, after the blueprint
links and "+ New collection", add a divider and a "Sets" link going to
`/settings/sets` (super-only):

```
SETTINGS
  ▾ Schema
      Authors
      Posts
      + New collection
      ────
      Sets
  Users
  Groups
```

This keeps Sets visually grouped with schema concerns without bumping it
to a top-level entry.

### Pinia store

```ts
// packages/admin/src/stores/sets.ts
export const useSetsStore = defineStore('sets', {
  state: () => ({ map: new Map<string, SetDTO>(), hydrated: false }),
  getters: { list: (s) => [...s.map.values()] },
  actions: {
    async hydrate() { if (!this.hydrated) await this.refresh(); this.hydrated = true; },
    async refresh() { const all = await api.listSets(); this.map = new Map(all.map(s => [s.handle, s])); },
    get(handle: string) { return this.map.get(handle); },
  },
});
```

Hydrated by `App.vue` alongside the blueprints store.

## API additions

Under `requireSuper`:

| Method | Path | Behavior |
| --- | --- | --- |
| GET    | `/api/sets` | List all sets. |
| POST   | `/api/sets` | Create a set. 422 on duplicate handle. |
| GET    | `/api/sets/:handle` | Fetch one. 404 if missing. |
| PATCH  | `/api/sets/:handle` | Update label or fields. Handle is immutable. |
| DELETE | `/api/sets/:handle` | Delete a set. Does NOT cascade — see "lifecycle". |

Request/response: the `SetDTO` matches `SetDefinition` plus
`createdAt` and `updatedAt`.

`GET /api/sets` is open to any signed-in user (the admin needs it for
the blueprint editor's chip picker even when the user isn't super —
though only super can write).

Actually re-checking spec for consistency: a non-super editor opening a
blueprint shouldn't need write access. Listing sets is read. We keep
**read open to any signed-in user**, **writes super-only**. Implement
with: `GET` not wrapped in `requireSuper`; mutation routes wrapped.

## Live rebuild

`packages/core/src/sets/events.ts`:

```ts
import { EventEmitter } from 'node:events';
export const setsEvents = new EventEmitter();
export type SetsChangeEvent = { handle: string; kind: 'create' | 'update' | 'delete' };
```

Mutations emit `setsEvents.emit('change', ...)`. The Vite plugin
subscribes (same way it subscribes to `blueprintEvents`) and rebuilds
the Hono app + broadcasts `vulse:sets-changed` over Vite WebSocket.
Admin store listens for the WS event and calls `setsStore.refresh()`.

## Deletion semantics

Deleting a set:
- Removes the row from `sets`.
- Does NOT touch blueprint definitions that reference the handle.
- Does NOT touch entries containing `vulseSet` nodes with the deleted
  set name.

UI behavior after deletion:
- `BlueprintEditor`'s chip picker omits the missing set; if a blueprint
  has `sets: ['quote', 'gallery']` and `quote` was deleted, only
  `gallery` appears as a checked chip; saving the blueprint persists
  the trimmed list.
- `BlocksField` toolbar dropdown only shows currently-existing sets.
- `VulseSetNodeView` for an orphan node renders a "missing set: foo"
  placeholder; remove/duplicate still work.
- Renderer's `VulseSet` component dispatches to a missing handler →
  renders `<div data-vulse-missing-set="foo"/>`.

The admin "Delete" button shows a confirm with a usage count:

> Set `quote` is referenced by 3 blueprints. Existing entries using this
> set will continue to store the data but no longer validate or render.
> Delete anyway?

Counts are computed from the blueprints store (cheap; runs in the
browser).

## Configuration & defaults

No new environment variables. Sets are seeded only by admin action — no
filesystem-based seeding (unlike blueprints, which can come from
`apps/dev/blueprints/*.ts`). v2 may add a `seedSetsFromCode` helper, but
v1 is admin-only.

## Testing

**`@vulse/core`:**
- `sets/__tests__/compile.test.ts` — compileSet produces the right Zod
  shape for each field kind.
- `sets/__tests__/service.test.ts` — CRUD, duplicate-handle rejection.
- `sets/__tests__/validate-tree.test.ts` — walk-and-validate for:
  good set data, bad set data (Zod issue surfaces with the right path),
  unknown set, deeply nested vulseSet inside paragraph inside other
  blocks, multiple set nodes in one doc.
- `blueprints/compile.test.ts` — extends with a case for a blocks field
  with `sets: ['quote']` that compiles into a superRefining schema.
- `http/__tests__/sets.api.test.ts` — read open, write super.
- `content/service.test.ts` — saving an entry with valid + invalid set
  data; assertion that issue paths look like `body.sets[0].data.author`
  rather than `body.0.attrs.data.author`.

**`@vulse/admin`:**
- `pages/__tests__/SetEditor.test.ts` — add field, set kind, save calls
  the right API.
- `components/fields/__tests__/VulseSetNodeView.test.ts` — insert,
  expand, edit a field, the updateAttributes payload matches expected
  shape; missing-set placeholder renders for unknown handle.
- `stores/__tests__/sets.test.ts` — hydrate / refresh / get.

**Smoke (`apps/dev/src/smoke.test.ts`):**
1. Sign in as super.
2. Create a `quote` set via `POST /api/sets`.
3. Update Posts blueprint: body field gains `sets: ['quote']`.
4. POST an entry with body containing a `vulseSet` node using `quote`
   with `{quote: 'Hi', author: 'Anna'}`. Expect 201.
5. POST the same entry shape but with bad data (`author` missing while
   required). Expect 422 with an issue path `body.sets.<n>.data.author`.
6. GET the entry; verify the `vulseSet` node round-trips intact.

## Implementation phasing (informational; plan executes this order)

- **Phase A — Core schema and library.** Migration 009, SetDefinition,
  SetDefinitionSchema, compileSet, loadSets, sets service, /api/sets
  routes, sets events, integration into createApi + Vite plugin.
- **Phase B — Validation pipeline.** Extend blocks UI schema with
  optional sets; compileBlueprint accepts the sets registry; blocks
  fields with sets get a superRefine that validates `vulseSet` nodes.
- **Phase C — TipTap node + editor UX.** vulse-set-extension.ts,
  VulseSetNodeView.vue, BlocksField.vue toolbar dropdown, BlueprintEditor
  chip picker.
- **Phase D — Admin pages + renderer.** SetList, SetEditor, sets Pinia
  store, sidebar entry, default renderer handler in
  `@vulse/renderer`, framework-agnostic HTML dispatch.
- **Phase E — Tests + smoke.** Each phase ships its own unit tests; this
  phase adds the smoke roundtrip.

Each phase ends green (`pnpm -r test`, `pnpm -r check`,
`pnpm biome check .`).

## Risks / open questions

1. **Set validation paths.** `validateSetNodes` emits paths reflecting
   the actual ProseMirror tree (e.g.
   `body.content.0.content.2.data.author` for a deeply nested set node).
   The admin maps these to inline field errors via each
   `VulseSetNodeView`'s own attrs subscription — the node-view component
   watches the global validation-errors map and renders inline issues
   for entries whose path-prefix matches its own location. No
   human-friendly path remapping in core; the admin is the only consumer
   that needs to resolve them, and it has the live ProseMirror state.
2. **Default summary value.** Statamic shows the first text-ish field's
   value as the collapsed summary. Defining "first text-ish field"
   precisely (`fields.find(f => f.ui.kind === 'text' || 'textarea')`) is
   the simplest rule; we can iterate later.
3. **Drag/drop reordering.** TipTap's `draggable: true` works for
   cursor-driven moves but doesn't give a visible drag handle. v2 can
   add one — the data model already supports any order.
4. **Renderer fallback semantics.** A missing per-set component on the
   site renders a hidden `<div data-vulse-missing-set>`. If consumers
   want a visible "Set not rendered" placeholder, they pass their own.
5. **`sets: []` (empty array)** in a blocks field means "set support
   wired but no sets available." The toolbar dropdown is hidden; no
   validation difference vs `sets` omitted. Either is fine; we use
   `optional()` so omission and `[]` mean roughly the same thing.
