# @vulse/host

Composable helpers that assemble `@vulse/core` + `@vulse/auth` + `@vulse/db`
into a runnable headless CMS server.

A user's `server.ts` typically uses these helpers to compose ~50–100 lines
of boot code. Upgrading Vulse becomes `pnpm up @vulse/*`.

## Exports

- `prepareDatabase(config)` — open libsql + run migrations
- `resolveSecrets({ appRoot, env })` — preview & image secrets, cache dir
- `createDefaultMailer({ bus, baseUrl, from })` — register welcome + reset templates
- `createDefaultAuth({ client, env, bus })` — `createAuth` with bus-wired callbacks
- `buildHandlers(opts)` — compose the API listener from runtime services
- `createNodeServer({ getListeners, apiPrefixes, staticRoots })` — Node `http.Server`
- `resolveStaticAsset(opts)` — static-file resolver with SPA fallback

See [docs/upgrading.md](https://github.com/ekrist1/vulsecms/blob/main/docs/upgrading.md)
for the reference `server.ts` and the upgrade workflow.
