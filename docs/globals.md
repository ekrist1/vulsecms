# Globals

Globals are site-wide content sets that are not tied to a single URL or
collection entry. Use them for footer copy, contact details, social links,
announcement banners, default SEO copy, or other content the frontend needs on
many pages.

They are public content. Do not store secrets, API keys, or raw analytics
scripts in Globals. Put scripts in `site.scripts` in `vulse.config.ts` so they
remain code-reviewed and easy to disable.

## 1. Data Model

A Global Set has a handle, label, and the same field definitions used by
blueprints:

```json
{
  "handle": "site",
  "label": "Site",
  "fields": [
    { "name": "siteName", "ui": { "kind": "text" }, "optional": false },
    { "name": "tagline", "ui": { "kind": "textarea" }, "optional": true }
  ]
}
```

The set definition lives in `global_sets`. The current content value lives in
`global_values` and is validated against the set definition when saved.

## 2. Admin Usage

Super users can manage Globals in the admin under:

```txt
Settings -> Globals
```

The v1 editor supports the common field kinds: text, textarea, blocks, date,
boolean, and asset. Select fields, relationship fields, drafts, revision
history, and per-group permissions are intentionally not part of v1.

## 3. Frontend Usage

Globals are exposed through the public HTTP API. A headless frontend
(Astro, Next, SvelteKit, …) fetches them at build time or at request time
and threads them through its own state layer.

The shape is:

```ts
type PublicGlobals = Record<string, Record<string, unknown>>;
```

So `globals.site` is the content for the `site` Global Set,
`globals.footer` is the content for the `footer` Global Set, and so on.

## 4. Public API

Globals are available without a cookie through the public API:

```txt
GET /api/public/globals
GET /api/public/globals/:handle
```

Example response:

```json
{
  "site": {
    "siteName": "Vulse",
    "tagline": "Content everywhere"
  },
  "footer": {
    "copyright": "2026 Vulse"
  }
}
```

Headless frontends can fetch this once during SSR and pass it through their own
state layer.

## 5. Admin API

Admin routes require a Vulse session. Writes require a super user.

```txt
GET    /api/globals
GET    /api/globals/:handle
POST   /api/globals
PATCH  /api/globals/:handle
PUT    /api/globals/:handle/value
DELETE /api/globals/:handle
```

`POST` and `PATCH` accept the Global Set definition. `PUT
/api/globals/:handle/value` accepts only the content object:

```json
{
  "siteName": "Vulse",
  "tagline": "Content everywhere"
}
```

Invalid content returns the standard Vulse validation envelope:

```json
{
  "error": "validation",
  "issues": [
    { "path": ["siteName"], "message": "Invalid input: expected string" }
  ]
}
```

## 6. SEO And Scripts

Globals are useful for default SEO content that editors should manage, such as
site name, default social image, address, organization data, or shared footer
metadata. You can read those values in custom views and pass them into your own
head logic.

For the built-in SEO conventions and script injection, use
[`docs/frontend-foundation.md`](./frontend-foundation.md). Keep Google Tag
Manager and similar snippets in `site.scripts`, not in a Global Set.

## 7. Current Boundaries

Globals v1 is deliberately small:

- All Global values are public.
- Writes are super-user only.
- No draft/publish workflow for Globals yet.
- No revision history for Globals yet.
- No per-set permissions yet.

Those features can be added later without changing the public shape of
`/api/public/globals`.
