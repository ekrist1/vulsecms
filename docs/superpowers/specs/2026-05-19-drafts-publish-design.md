# Drafts & Publish — Design

**Date:** 2026-05-19
**Status:** Approved, ready for implementation plan

## Problem

Today every `Save` in the Vulse admin writes straight to `entries.content`,
which is what the public site renders. There is no way to edit a published
entry without affecting the live version. We want a Statamic-style workflow
where an editor can save changes that stay invisible to the public until
explicitly published.

## Goals

- Editors can save changes to an entry without those changes appearing on
  the public site.
- A single explicit action (`Publish`) promotes the working copy to live.
- Editors can preview an unpublished draft on the actual public site via a
  short-lived signed URL.
- Permission to publish is separable from permission to edit.
- Collections that don't need drafts (singletons, internal-only data) keep
  today's behaviour with zero ceremony.

## Non-goals (deliberate, deferred)

- Scheduled publishing (`publish_at` + worker). Possible future spec.
- Publishing an arbitrary past revision. Achievable later by extending
  `publish()` with `{ fromRevisionId? }`.
- Multi-author conflict resolution on the same draft. v1 is last-write-wins.
- Per-locale drafts. Out of scope until Vulse has locales.

## Workflow chosen

Explicit save-or-publish on every save. Editor toolbar exposes two actions:

- **Save draft** — writes to working copy only; live site unaffected.
- **Save & publish** — writes to working copy AND promotes to live.

Plus three peripheral actions: `Publish` (promote existing draft),
`Unpublish` (demote live to draft), `Discard draft` (throw away pending
changes).

Drafts are opt-in per collection via a `drafts: true` flag in the blueprint
definition. Default is `false` so existing behaviour is unchanged.

## Data model

Migration `010_drafts.sql`:

```sql
ALTER TABLE entries           ADD COLUMN draft_content TEXT;
ALTER TABLE entries           ADD COLUMN published_at  TEXT;
ALTER TABLE entries           ADD COLUMN published_by  TEXT;
ALTER TABLE group_permissions ADD COLUMN can_publish   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE revisions         ADD COLUMN kind          TEXT NOT NULL DEFAULT 'draft';
UPDATE entries SET published_at = updated_at WHERE status = 'published' AND published_at IS NULL;
```

- `entries.content` — unchanged semantics. The live, public copy.
- `entries.draft_content` — the unpublished working copy (JSON, same shape
  as `content`) or `NULL` when there are no pending changes.
- `entries.published_at`, `entries.published_by` — when/who last promoted
  the entry.
- `entries.status` — already exists. Now meaningful:
  - `published` — has been published at least once. `content` is live. May
    also have `draft_content` (unpublished edits on top).
  - `draft` — never published. `content` is empty; `draft_content` holds
    the editor's work. The site treats this as 404.
- `group_permissions.can_publish` — per-collection publish permission.
  Surfaced as the action `publish` in `effectivePerms`.
- `revisions.kind` — `'draft'` or `'publish'`, so history views can
  distinguish autosaves from publish events. Existing rows backfill to
  `'draft'` (safe — they were not publish events under the new semantics).

Backfill is purely additive: every existing row stays `status='published'`,
`published_at = updated_at`, `draft_content = NULL`. Nothing breaks.

The blueprint flag lives in `blueprint_definitions.definition` JSON as
`drafts: true`. No new column on `blueprint_definitions` is needed.

## Service API (`@vulse/core`)

```ts
interface ContentService {
  list(handle, opts?: { includeDrafts?: boolean; ... }): ...
  get(handle, id): ...
  create(handle, input, ctx, opts?: { publish?: boolean }): Promise<Entry>;
  update(handle, id, input, ctx, opts?: { publish?: boolean }): Promise<Entry>;
  delete(handle, id): ...

  publish(handle, id, ctx): Promise<Entry>;       // draft_content -> content
  unpublish(handle, id, ctx): Promise<Entry>;     // content -> draft_content, status=draft
  discardDraft(handle, id, ctx): Promise<Entry>;  // null out draft_content
}
```

`Entry` DTO grows:

```ts
interface Entry {
  // ...existing fields
  draftContent: Record<string, unknown> | null;
  hasUnpublishedChanges: boolean;       // derived: draftContent !== null
  publishedAt: string | null;
  publishedBy: string | null;
}
```

### Mutation matrix (drafts-enabled collection)

| Action                          | New entry                                          | Existing published entry                                        | Existing draft entry                                      |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| `create({ publish: false })`    | `status=draft`, `content='{}'`, working data written to `draft_content` | n/a                                                  | n/a                                                       |
| `create({ publish: true })`     | `status=published`, written to `content`, `published_at=now` | n/a                                                       | n/a                                                       |
| `update({ publish: false })`    | n/a                                                | writes `draft_content`; `content` untouched                     | writes `draft_content`                                    |
| `update({ publish: true })`     | n/a                                                | writes `content`, clears `draft_content`, `published_at=now`    | promotes: writes `content`, clears draft, `status=published`, `published_at=now` |
| `publish`                       | n/a                                                | copies `draft_content` → `content`, clears draft, `published_at=now` | promotes; status=published                            |
| `unpublish`                     | n/a                                                | moves `content` → `draft_content`, `status=draft`, `published_at=NULL` | error `entry_already_draft`                        |
| `discardDraft`                  | n/a                                                | clears `draft_content` (must be non-null); live copy untouched  | error `cannot_discard_initial_draft`                     |

For collections without `drafts: true`:

- `create`/`update` ignore the `publish` flag and behave exactly as today —
  always writes to `content`, status stays `'published'`.
- `publish`/`unpublish`/`discardDraft` throw `ValidationError` with code
  `drafts_not_enabled`.

### Listing & reads

`list()` accepts `includeDrafts?: boolean` (default `false`). The public
site and the route-override filter system **never** set it, so only
published rows reach the site.

`get()` always returns the entry (admin lookups need to see drafts). The
DTO includes both `content` and `draftContent`; the admin editor reads
`draftContent ?? content` to populate the form so it always shows the
latest working state.

### Revisions

Every save snapshots a revision as it does today. The new `kind` column
records whether the snapshot came from a draft save (`'draft'`) or a
publish event (`'publish'`). Useful for history views and audit.

## HTTP API

All under existing `/api` prefix.

### Modified

- `POST   /api/collections/:handle/entries` — body accepts `publish?: boolean`.
- `PATCH  /api/collections/:handle/entries/:id` — body accepts `publish?: boolean`.
- `GET    /api/collections/:handle/entries` — query accepts `includeDrafts=1`
  (admin only — see below).
- `GET    /api/collections/:handle/entries/:id` — DTO now includes
  `draftContent`, `hasUnpublishedChanges`, `publishedAt`, `publishedBy`.

`includeDrafts=1` requires the caller to have `read` permission on the
collection. If absent, only `status='published'` rows are returned
regardless of who's calling. This protects the public route-override
`GET /api/collections/:handle` endpoint, which never sets `includeDrafts`.

### New publish actions

- `POST   /api/collections/:handle/entries/:id/publish`   — requires `publish`.
- `POST   /api/collections/:handle/entries/:id/unpublish` — requires `publish`.
- `DELETE /api/collections/:handle/entries/:id/draft`     — requires `update`.

All return the updated `Entry` DTO.

### Preview token

- `POST   /api/collections/:handle/entries/:id/preview-token` — requires `read`.
  Returns `{ token: "vp_...", expiresAt: ISO8601 }`.

Token is a 15-minute HMAC over `{entryId, userId, exp}` signed with
`VULSE_PREVIEW_SECRET` (falls back to `VULSE_SESSION_SECRET` if unset).

### Status codes / error shapes

- `publish` / `unpublish` / `discardDraft` on a drafts-disabled collection
  → `400 ValidationError { code: 'drafts_not_enabled' }`.
- Missing permission → `403`.
- `unpublish` of a never-published entry → `409 { code: 'entry_already_draft' }`.
- `discardDraft` on a published entry whose `draft_content` is already null
  → `409 { code: 'no_draft_to_discard' }`.
- `discardDraft` on a `status='draft'` entry (no published copy to fall
  back to) → `409 { code: 'cannot_discard_initial_draft' }`. Use `DELETE`
  the whole entry instead.

## Admin UI

### Editor toolbar (drafts-enabled collection)

The primary Save button becomes a split button:

```
┌──────────────────────┬───┐
│ Save & publish       │ ▾ │   ← primary; disabled if no `publish` perm
└──────────────────────┴───┘
       Save draft                ← in dropdown
       Discard draft             ← only when hasUnpublishedChanges
       Unpublish                 ← only on published entries, requires `publish`
```

The user's last choice (Save draft vs Save & publish) is remembered per
browser via `localStorage['vulse.editor.lastSaveAction']`, so repeated
saves don't require re-clicking the menu. The primary button always
reflects that last choice; the other is one click away.

For collections without drafts, the button stays a plain `Save` — no
visible UI changes.

### Status badge

Next to the entry title:

- `● Draft` — never published; amber dot.
- `● Published` — green dot.
- `● Published · unpublished changes` — green dot + amber outline when
  `hasUnpublishedChanges`.

### Preview button

Icon button, top right of the editor. Enabled when
`hasUnpublishedChanges || status==='draft'`. Click flow:

1. `POST` `/preview-token`.
2. Resolve the entry's public URL via the existing site-route system.
3. Open the URL in a new tab with `?vulse-preview=<token>` appended.

### Entry list view

- New `Status` column showing the badge.
- New filter chip: `Drafts only / Published only / All` — toggles the
  `includeDrafts` and `filter[status][eq]` query params.

### Schema editor

Per-collection: one new checkbox **Enable drafts (Save changes without
affecting the live site)**. Toggling it OFF on a collection that currently
has draft entries shows a confirm modal:

> "3 entries have unpublished changes. Disabling drafts will discard
> them. Continue?"

On confirm: the schema flips off and pending drafts are discarded
(`draft_content = NULL`, `status` left as-is).

### Permissions UI

Per-collection: new **Publish** checkbox alongside Read/Create/Update/Delete
in the Groups settings page.

## Public site & preview

### Default render

The site keeps reading `entries.content`. A new filter is added at the top
of `resolveSiteRequest` (`packages/site/src/server/middleware/render.ts`):

> Every `list()` and `get()` call the site makes is constrained to
> `filter: { status: { eq: 'published' } }`. Any single-entry lookup whose
> row comes back with `status='draft'` short-circuits to the 404 path.

This filter does not exist today (drafts can't reach the site because
nothing flips `status`), but is required once drafts are possible.

### Preview flow

1. Editor clicks **Preview** in the admin → `POST /preview-token`.
2. Admin opens the resolved public URL with `?vulse-preview=<token>` in a
   new tab.
3. The site middleware sees the query param **before** the published-status
   filter is applied. It verifies the HMAC and `exp`, extracts `entryId`.
4. If valid: load that entry's `draftContent ?? content` and substitute it
   for the normal `content` when assembling route state. Set
   `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`. Render
   a small banner: *"Preview — unpublished changes. Token expires in
   14 min."*
5. If invalid/expired/mismatched route: fall back to normal published
   rendering (so a stale link silently shows the live version rather than
   breaking).

The preview swaps in the draft for the **specific entry** named in the
token only — not the whole request. Lists on the same URL still show
published rows; only a single-entry detail page gets the swap. Small blast
radius, easy to reason about.

## Permissions

`group_permissions.can_publish` becomes the fifth per-collection action,
surfaced as `publish` in `effectivePerms`. An editor with `update` but
without `publish`:

- Can use **Save draft**.
- The **Save & publish** primary action is disabled with a tooltip
  ("You don't have permission to publish in this collection").
- `Publish` / `Unpublish` menu items are hidden.
- `POST /publish` and `POST /unpublish` return `403`.

Super-admins implicitly have `publish` everywhere (existing `'*'` wildcard
in `effectivePerms`).

## Tests

`packages/db/src/schema.test.ts` — new columns + `can_publish` present
after migration.

`packages/core/src/content/__tests__/drafts.test.ts` (new):

- create/update with `publish: false` on drafts-enabled collection writes
  to `draft_content`.
- create/update with `publish: true` writes to `content` and clears draft.
- `publish` promotes draft → live, sets `published_at`/`published_by`.
- `unpublish` reverses it.
- `discardDraft` clears draft, leaves content; errors on draft-status
  entry.
- All three new methods throw `drafts_not_enabled` on drafts-disabled
  collections.
- `list({ includeDrafts: false })` hides draft-status rows;
  `includeDrafts: true` includes them.
- Revision rows are created with `kind = 'draft' | 'publish'` correctly.
- Non-drafts collection behaves exactly as today (regression guard).

`packages/core/src/http/...` — API tests for the three new endpoints, the
modified `publish` body flag, and `403` when the caller lacks `publish`.

`packages/core/src/preview/preview-token.test.ts` (new) — sign/verify
round-trip, expiry, tamper rejection.

`packages/site/src/server/middleware/render.test.ts` — extend:

- `status='draft'` entry 404s on the public site.
- Valid preview token swaps in `draft_content` for the targeted entry only.
- Expired/invalid token falls back to published rendering.
- `noindex` header set on preview responses.

`packages/admin/src/...` — component tests for the split Save button, the
status badge variants, and the Preview button enabling only when there's
something to preview.

## Developer documentation

- `docs/database.md` — add the `draft_content`, `published_at`,
  `published_by`, `can_publish`, and `revisions.kind` columns to the
  schema reference.
- `docs/drafts.md` (new) — user-facing concept doc: workflow, blueprint
  opt-in, permission, preview, the mutation matrix.
- `docs/auth.md` — add `publish` to the list of per-collection actions.

A short admin UI empty state for drafts-enabled collections links to
`docs/drafts.md`.

## Migration safety

All schema changes are `ALTER TABLE ADD COLUMN` with defaults or NULLs —
no table rewrites. The backfill `UPDATE` runs in the same migration file.
The dev DB will be reset during implementation (per user agreement).
