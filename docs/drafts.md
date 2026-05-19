# Drafts and Publishing

Some Vulse collections support a Statamic-style draft workflow: editors can
save changes that stay invisible to the public site until explicitly
published, and previewing a draft uses the actual public URL (with a
short-lived signed token).

## Opting a collection in

In **Settings → Schema → <Collection>**, tick **Enable drafts**. Existing
entries are unaffected — they stay published with no working copy until
someone saves a draft on top.

Without the flag, saving works exactly as it does today — every save updates
the live site immediately.

## Save actions

For drafts-enabled collections the editor's primary button is a split button:

- **Save draft** — writes the working copy. The public site keeps showing the
  previous published version (or 404s for never-published entries).
- **Save & publish** — writes the working copy and promotes it to live.

The dropdown also exposes:

- **Discard draft** — throws away unpublished changes; the live version is
  untouched.
- **Unpublish** — moves the live copy back to a draft. The entry leaves the
  public site until republished.

The button remembers the action you used last in this browser, so repeated
saves don't need extra clicks.

## Previewing

Click **Preview** in the editor toolbar to open the entry on the public site
in a new tab. The URL carries a 15-minute signed token that swaps in the
draft for the target entry only — live visitors still see the published
version. Preview pages set `X-Robots-Tag: noindex, nofollow` and
`Cache-Control: no-store`.

## Permissions

The Groups settings page now has a **Publish** checkbox alongside Read /
Create / Update / Delete. An editor with `update` but no `publish` can only
**Save draft** — the **Save & publish** action is disabled.

## Behaviour reference

| Situation                                       | What happens                            |
| ----------------------------------------------- | --------------------------------------- |
| New entry, **Save draft**                       | Created with status=draft; public 404s. |
| New entry, **Save & publish**                   | Created live (status=published).        |
| Published entry, **Save draft**                 | Working copy written; live unchanged.   |
| Published entry, **Save & publish**             | Live copy replaced.                     |
| Draft entry, **Save & publish**                 | Promoted to status=published.           |
| Published entry with working copy, **Publish**  | Working copy promoted; draft cleared.   |
| Published entry, **Unpublish**                  | Live copy demoted to draft; public 404. |
| Published entry, **Discard draft**              | Working copy cleared.                   |
| Draft entry, **Discard draft**                  | Refused — delete the entry instead.     |
| Drafts-disabled collection, any save            | Writes live, exactly as today.          |

## Environment

Preview tokens are signed with `VULSE_PREVIEW_SECRET`. If unset, Vulse falls
back to `VULSE_SESSION_SECRET`; if neither is set, a warning is logged and
an ephemeral per-process secret is generated (preview links don't survive
restarts in that case).

## Out of scope (for now)

- Scheduled publishing.
- Re-publishing an arbitrary past revision.
- Locking / multi-author conflict resolution on a shared draft.
