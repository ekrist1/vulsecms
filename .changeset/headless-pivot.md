---
'@vulse/core': major
'@vulse/auth': major
'@vulse/db': major
'@vulse/host': major
'@vulse/image': major
'@vulse/renderer': major
'@vulse/admin': major
---

Headless pivot: the `@vulse/site` Vue 3 SSR runtime has been removed.
Vulse now ships exclusively as a headless CMS — the admin SPA plus the
HTTP API. Public-facing sites live in a separate frontend project
(Astro, Next, SvelteKit, Nuxt, …) that fetches content from
`/api/public/*`.

**Breaking changes:**

- `@vulse/site` is no longer published. Remove it from `package.json`.
- `@vulse/host`'s `buildHandlers` no longer accepts a `site` option and
  no longer returns a `site` listener. The result is `{ api, apiApp }`.
- `@vulse/host` no longer depends on `@vulse/site`.
- `vulse.config.ts` no longer has a `site` field.
- Project `vite.config.site.ts` files should be deleted.
- The renderer remains published and is still imported by the admin
  SPA; it can also be used from any Vue-based frontend that wants to
  render Vulse block content.

See `docs/upgrading.md` for the step-by-step migration guide and
`docs/frontend-foundation.md` for the new headless integration recipe
(Astro is the worked example).

The HTTP API contract (`/api/public/*`, `/_vulse/img/*`,
`/api/blueprints`, auth, drafts, preview tokens) is **unchanged**.
