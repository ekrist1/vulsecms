# Vulse

A TypeScript-first CMS built on Vite, Vue 3, libsql, and h3. Ships as a
set of `@vulse/*` packages and a `create-vulse` scaffold so projects stay
upgradeable.

> **This README is for repo maintainers and contributors.** End users
> should start at [docs/architecture.md](./docs/architecture.md) and
> [docs/upgrading.md](./docs/upgrading.md).

## Packages

| Package           | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `@vulse/db`       | libsql adapter, migration runner, core schema        |
| `@vulse/auth`     | Better-auth wrapping, users/groups/sessions, RBAC    |
| `@vulse/core`     | Blueprints, content service, HTTP API, event bus, mailer, module loader |
| `@vulse/site`     | Vue 3 SSR site runtime + Vite plugin                 |
| `@vulse/image`    | Sharp probe + resize + signed URLs                   |
| `@vulse/renderer` | Vue field renderers (shared admin + site)            |
| `@vulse/admin`    | Vue 3 admin SPA (consumed as source)                 |
| `@vulse/host`     | Composable helpers that compose the above into a server |
| `create-vulse`    | Scaffold CLI (`npm create vulse@latest`)             |

All `@vulse/*` packages are *linked* in `.changeset/config.json` and ship
with the same version number. `create-vulse` versions independently.

## Layout

```
packages/         # published code
apps/dev/         # in-repo reference + integration-test app
docs/             # user-facing documentation
.changeset/       # versioning + changelogs (see below)
```

`apps/dev` is **not** a template for end users — it stays in this repo as
the canonical integration-test target. The actual user-facing template
lives in `packages/create-vulse/template/`.

## Working in the repo

```sh
pnpm install
pnpm dev          # boot apps/dev on http://localhost:5173
pnpm test         # run all vitest suites
pnpm check        # type-check everything + biome
pnpm format       # biome format
pnpm build        # build every package + apps/dev
```

## The package boundary (very important)

The rule that makes Vulse upgradeable:

> Scaffold once. Update packages forever. Migrate user files only with
> explicit codemods or documented manual steps.

When considering a change, ask:

1. **Does this change belong in `packages/*` (engine) or in a user's app
   directory (composition)?** If a user would reasonably want to override
   it, it belongs in their app — add an extension point, not a config
   knob inside core.
2. **Does the change require user-side code edits?** If yes, document it
   in `docs/upgrading.md` under a per-version section, and prefer adding
   a deprecation cycle on minor releases instead of an immediate break.
3. **Is there already an extension point that covers this?** Event bus,
   VulseModule, mailer template registry, auth callbacks. Use them
   before adding a new one.

## Release workflow

We use [changesets](https://github.com/changesets/changesets):

```sh
# When you make a change that should ship:
pnpm changeset
# Pick packages, pick bump type, write a one-line summary.
# Commit the .changeset/*.md file alongside your PR.

# When it's time to release:
pnpm version-packages    # consume changesets → bumps + CHANGELOG.md
git commit -am "chore: release"
pnpm release             # build + npm publish
```

### Publishing for the first time

Before the first publish:

1. Claim the `@vulse` scope on npm (`npm org create vulse` or `npm login`
   under an existing org member account).
2. Run `pnpm -r --filter './packages/**' build` and verify each `dist/`
   directory looks right (`ls packages/*/dist`).
3. `pnpm changeset publish` (via `pnpm release`).

Subsequent releases follow the workflow above.

## Semver policy

We follow standard semver, scoped per `@vulse/*` linked group:

- **Patch (0.1.0 → 0.1.1):** Bug fixes. No user code changes required.
- **Minor (0.1.0 → 0.2.0):** New features, new extension points, new
  helpers. Existing code keeps working.
- **Major (0.x → 1.0):** Breaking API changes. Documented in
  `docs/upgrading.md` with a migration recipe.

Before 1.0, expect that minor releases may occasionally break — when
that happens it is called out clearly in the changelog *and* in the
upgrade guide.

## What lives where (decision guide)

| Concern                                  | Lives in                       |
| ---------------------------------------- | ------------------------------ |
| Anything a user reasonably wants to customise per-project | `packages/create-vulse/template/` |
| Reusable composition logic               | `packages/host/`               |
| Database schema, blueprints, content     | `packages/core/`, `packages/db/` |
| Auth flows, session handling             | `packages/auth/`               |
| Default email templates                  | `packages/host/src/mailer.ts`  |
| HTTP route shape                         | `packages/core/src/http/`      |
| SSR site rendering                       | `packages/site/`               |
| Admin SPA                                | `packages/admin/`              |
| Reference / integration test app         | `apps/dev/`                    |

If you can't decide where something goes, ask: **"Would a user want to
override this without us shipping a release?"** If yes, it's an extension
point. If no, it's package code.

## Contributing

1. Open an issue first for anything non-trivial.
2. Make the change in a single focused PR.
3. Add tests (`vitest run` should pass for the touched package).
4. Run `pnpm changeset` and commit the markdown alongside.
5. Update `docs/` if the change affects user-facing behaviour.

## License

MIT — see [LICENSE](./LICENSE).
