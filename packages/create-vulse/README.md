# create-vulse

Scaffold a new [Vulse](https://github.com/ekrist1/vulsecms) project.

```sh
npm create vulse@latest my-app
# or
pnpm create vulse my-app
```

You'll get a minimal user-owned app that depends on the `@vulse/*` packages
and can be upgraded with `pnpm up "@vulse/*"`. No core code lives in your
project — extensions go in `modules/`, content shapes in `blueprints/`, and
your composition in `server/server.ts`.

## Options

| Flag           | Meaning                                       |
| -------------- | --------------------------------------------- |
| `--force, -f`  | Scaffold into a non-empty target directory.   |
| `--help, -h`   | Show usage.                                   |

## What gets scaffolded

```
my-app/
  package.json
  vulse.config.ts
  tsconfig.json
  vite.config.ts          # admin SPA dev
  vite.config.site.ts     # SSR site build
  vite.config.server.ts   # server entry build
  blueprints/posts.ts     # one example collection
  modules/
    index.ts
    welcome.ts            # one example module
  server/server.ts        # ~90-line composition using @vulse/host
  src/main.ts             # admin entry
  index.html              # admin shell
  .gitignore
  .env.example
```
