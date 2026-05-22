# Changesets

We use [changesets](https://github.com/changesets/changesets) to version and
publish `@vulse/*` packages.

## Workflow

When you make a change to a `@vulse/*` package:

```sh
pnpm changeset
```

Pick the packages that changed, choose a bump type (patch/minor/major), and
write a one-line description. Commit the resulting markdown file in
`.changeset/*.md` along with your code.

## Releasing

When you're ready to cut a release:

```sh
pnpm version-packages   # consume changesets → version bumps + CHANGELOGs
git commit -am "chore: release"
pnpm release            # build + npm publish to the configured registry
```

## Linked packages

`@vulse/core`, `@vulse/auth`, `@vulse/db`, `@vulse/host`, `@vulse/site`,
`@vulse/image`, `@vulse/renderer`, and `@vulse/admin` are linked — they
release together with the same version. This keeps the upgrade story
simple for users: bump them all in lockstep.

`create-vulse` and the in-repo `@vulse/dev` reference app are ignored by
changesets — they version independently.
