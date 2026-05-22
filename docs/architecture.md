# Architecture

This document explains how Vulse is organised and, more importantly, how to
extend it without touching core. If you came from Laravel, the rough mental
map is:

| Laravel concept      | Vulse equivalent                          |
| -------------------- | ----------------------------------------- |
| Events + Listeners   | `EventBus` (`createEventBus`)             |
| Service Providers    | `VulseModule` + `loadModules`             |
| Migrations           | SQL files run by `runMigrations`          |
| Mailables / Notifications | `Mailer` template registry           |
| Artisan              | (not yet — explicit wiring for now)       |

Vulse is intentionally smaller than Laravel: it does not autodiscover modules
or hide configuration behind facades. Extension points are explicit objects
you compose in your app's `server/server.ts` and `modules/` folder.

## Project vs. package boundary

This is the most important rule and the reason Vulse stays upgradeable:

> **Vulse packages live in `node_modules`. Your project owns its config,
> blueprints, modules, and composition. Do not edit files inside
> `node_modules/@vulse/*`.**

| Layer              | What's in it                                | Who owns it |
| ------------------ | ------------------------------------------- | ----------- |
| `@vulse/*` packages | engine: schema, services, helpers          | maintainers |
| your project       | `vulse.config.ts`, `blueprints/`, `modules/`, `server/server.ts`, `src/main.ts` | you |

Updating Vulse is `pnpm up "@vulse/*"`. See [docs/upgrading.md](./upgrading.md).

If you reach for a fork or monkey-patch, that signals a missing extension
point — open an issue rather than diverging.

## Package layout

```
packages/
  db/         libsql client, migrations, schema
  auth/       better-auth wiring, users/groups/sessions, RBAC
  core/       blueprints, content, HTTP API, event bus, modules, mailer
  host/       composable helpers (prepareDatabase, buildHandlers, ...)
  site/       SSR site runtime + Vite plugin
  admin/      Vue admin SPA (consumed as source)
  image/      image probe + resize
  renderer/   field renderers
  create-vulse/  scaffold CLI for new projects
apps/
  dev/        in-repo reference + integration-test app
```

`@vulse/host` depends on the rest. A user's `server.ts` depends only on
`@vulse/host`, `@vulse/core`, `@vulse/auth`, `@vulse/db`, and `@vulse/site`.

## Extension seams

Three seams cover almost every extension a developer will want to ship.

### 1. The event bus

`createEventBus()` returns a typed pub/sub instance. Listener errors are
isolated — one failing listener does not block the rest.

```ts
import { createEventBus } from '@vulse/core';

const bus = createEventBus();

bus.on('user.registered', async (payload) => {
  // payload: { userId, email, name }
  await myAnalytics.track('signup', payload);
});

await bus.emit('user.registered', { userId: 'u1', email: 'a@b', name: null });
```

Built-in events:

| Event                              | Payload                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `user.registered`                  | `{ userId, email, name }`                            |
| `user.password_reset_requested`    | `{ userId, email, name, resetUrl }`                  |
| `blueprint.changed`                | `{ handle, kind: 'create'\|'update'\|'delete' }`     |

Plugins add their own events with declaration merging:

```ts
declare module '@vulse/core' {
  interface VulseEvents {
    'newsletter.subscribed': { email: string };
  }
}
```

### 2. The module manifest

A `VulseModule` is a plain object that can register migrations, HTTP routes,
listeners, and a one-shot setup hook. Modules are passed explicitly to
`loadModules` from the host:

```ts
import type { VulseModule } from '@vulse/core';

export const newsletter: VulseModule = {
  name: 'newsletter',
  migrationsDir: new URL('./migrations/', import.meta.url).pathname,
  routes(router) {
    router.post('/api/newsletter/subscribe', async (event) => {
      /* ... */
    });
  },
  listeners(bus) {
    bus.on('user.registered', async ({ email }) => {
      // auto-subscribe new users
    });
  },
  setup({ db, bus }) {
    // optional last-chance hook (runs after migrations + routes + listeners)
  },
};
```

In your app:

```ts
import { loadModules } from '@vulse/core';
import { newsletter } from './modules/newsletter';

await loadModules([newsletter], { db, bus, router: api });
```

Conventions:

- `name` must be unique across loaded modules.
- Migrations are namespaced as `${name}:${filename}` in `_vulse_migrations`,
  so two modules can both ship a `001_init.sql`.
- `routes` is only called when the host provides a router. The dev/prod
  servers pass the API router here; a future "headless library" mode may
  not.
- `listeners` and `setup` always run.

### 3. Migrations

`runMigrations(db, dir, { module: 'newsletter' })` reads every `.sql` file in
`dir` lexicographically, runs them in a transaction, and stamps the
`_vulse_migrations` table.

There is no ORM. Write SQL. The libsql client supports the SQLite dialect.

Module-namespaced runs are isolated from core: rerunning the core migration
set does not re-apply module migrations and vice versa.

## Customising email

The `Mailer` is a registry of per-event templates plus a transport. It
deliberately has no DSL — each part of the email is a function that takes the
event context and returns a string (or a buffer for attachments).

```ts
import { createMailer, logTransport, smtpTransport } from '@vulse/core';

const mailer = createMailer({
  transport: process.env.SMTP_URL
    ? smtpTransport(process.env.SMTP_URL)
    : logTransport(process.stdout),
  from: 'no-reply@example.com',
});

mailer.register('user.registered', {
  subject: (ctx) => `Welcome, ${ctx.name ?? ctx.email}`,
  text: (ctx) => `Hi ${ctx.email}, you're in.`,
  html: (ctx) => `<p>Hi <strong>${ctx.email}</strong>, you're in.</p>`,
  attachments: () => [
    { filename: 'guide.pdf', content: readFileSync('./guide.pdf') },
  ],
});

mailer.sendOnEvent(bus, 'user.registered', (payload) => ({
  to: payload.email,
  context: payload,
}));
```

A later `register()` call **replaces** the existing template, so a module can
override the host's default:

```ts
// in a module's setup() hook
mailer.register('user.registered', {
  subject: () => '🎉 You joined the cool club',
  text: (ctx) => `Welcome aboard, ${ctx.name ?? 'friend'}.`,
});
```

For ad-hoc events that are not in the typed `VulseEvents` map, use
`mailer.registerByKey('any.string', tpl)` + `mailer.sendByKey('any.string', ...)`.

### Skipping a send

Return `null` from the `sendOnEvent` mapper to suppress a particular send
without disabling the subscription:

```ts
mailer.sendOnEvent(bus, 'user.registered', (payload) =>
  payload.email.endsWith('@example.com')
    ? null  // skip seeded test users
    : { to: payload.email, context: payload }
);
```

### Transports

| Transport      | When to use                                       |
| -------------- | ------------------------------------------------- |
| `logTransport` | Dev. Writes the rendered email to a stream.       |
| `smtpTransport`| Production. Thin wrapper around nodemailer.       |
| (custom)       | Implement `MailTransport.send(message)` yourself. |

A custom transport is a one-method interface — wire up Postmark, SES, or a
test capture without depending on nodemailer:

```ts
import type { MailTransport } from '@vulse/core';

const postmark: MailTransport = {
  async send(message) {
    await fetch('https://api.postmarkapp.com/email', { /* ... */ });
  },
};
```

## Lifecycle

A normal boot sequence looks like this:

```
1.  open libsql client
2.  PRAGMA foreign_keys = ON
3.  runMigrations(db, MIGRATIONS_DIR)              ← core schema
4.  seedBlueprintsFromCode(...)
5.  createEventBus()
6.  createMailer({ transport, from })              ← register templates
7.  mailer.sendOnEvent(bus, …)                     ← bus → mailer wiring
8.  createAuth({ callbacks: { onUserCreated, sendResetEmail } })
9.  seedSuperUser(…)
10. loadModules(modules, { db, bus, router })      ← module migrations,
                                                       routes, listeners
11. createApi({ adapter, authInstance, bus, onUserCreated, … })
12. server.listen()
```

The `apps/dev/src/server.prod.ts` file in this repo is the canonical
reference. Read it before composing a new host.

## Adding a new feature: worked example

> Send a welcome email with a guide PDF when a new user signs up, and add a
> `/api/welcome-status` endpoint that reports how many welcome emails have
> been sent.

```ts
// modules/welcome.ts
import { readFileSync } from 'node:fs';
import type { VulseModule } from '@vulse/core';

let sent = 0;

export const welcome: VulseModule = {
  name: 'welcome',
  migrationsDir: new URL('./migrations/', import.meta.url).pathname,
  routes(router) {
    router.get('/api/welcome-status', () => ({ sent }));
  },
  listeners(bus) {
    bus.on('user.registered', () => {
      sent++;
    });
  },
  setup({ /* db, bus, router */ }) {
    // nothing to do here for this module
  },
};

export function registerWelcomeTemplate(mailer: import('@vulse/core').Mailer) {
  mailer.register('user.registered', {
    subject: (ctx) => `Welcome, ${ctx.name ?? ctx.email}`,
    text: (ctx) => `Hi ${ctx.email}, here's your getting-started guide.`,
    attachments: () => [
      {
        filename: 'guide.pdf',
        content: readFileSync(new URL('./assets/guide.pdf', import.meta.url)),
        contentType: 'application/pdf',
      },
    ],
  });
}
```

```ts
// server.prod.ts (excerpt)
import { welcome, registerWelcomeTemplate } from './modules/welcome';

registerWelcomeTemplate(mailer);   // override the default user.registered template
await loadModules([welcome], { db, bus, router: api });
```

No core file was touched.

## Non-goals (today)

- **No autodiscovery.** Modules are explicit. We may add a discovery
  convention once we have three or four real modules to learn from.
- **No artisan-equivalent CLI.** Scaffolding is left as a future iteration.
- **No ORM.** Migrations and queries are SQL. The libsql adapter is the
  contract.
- **No event sourcing.** The bus is in-process and ephemeral. If you need
  durability, write a module that persists to the DB and replays on boot.
