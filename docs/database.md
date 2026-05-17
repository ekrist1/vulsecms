# Database

Vulse is built on a libSQL-compatible store. The same code path runs against:

- a **local SQLite file** (default — great for development),
- a **Turso Cloud** database (great for production hosting), or
- an **embedded replica** that keeps a local file in sync with a remote master
  (low-latency reads with cloud durability).

The driver is selected by environment variables at startup. There is no
runtime toggle — point the server at a different URL and restart.

## Environment variables

| Variable                   | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `VULSE_DB_URL`             | Connection URL: `file:...`, `libsql://...`, `http(s)://...` |
| `VULSE_DB_AUTH_TOKEN`      | Bearer token for remote libSQL (Turso)                  |
| `VULSE_DB_SYNC_URL`        | Remote URL when running an embedded replica             |
| `VULSE_DB_SYNC_INTERVAL`   | Seconds between background sync pulls (replica only)    |
| `VULSE_DB_ENCRYPTION_KEY`  | At-rest encryption key for the local file               |

Defaults to `file:./dev.db` when nothing is set.

## Connecting to Turso Cloud

1. Create a database and an auth token with the [Turso CLI](https://docs.turso.tech/cli):

   ```bash
   turso db create my-vulse
   turso db tokens create my-vulse
   ```

2. Set the connection variables before starting Vulse:

   ```bash
   export VULSE_DB_URL="libsql://my-vulse-<org>.turso.io"
   export VULSE_DB_AUTH_TOKEN="<token>"
   pnpm dev   # or pnpm --filter @vulse/dev start
   ```

   Vulse runs its migrations automatically on first connect.

3. Confirm in the admin under **Settings → Database** — the page shows the
   active driver, scheme, host, and replica configuration (without secrets).

## Embedded replicas

Embedded replicas store a local copy of the database that periodically syncs
with a remote master. Reads are served from the local file (microseconds);
writes go to the master.

```bash
export VULSE_DB_URL="file:./replica.db"
export VULSE_DB_SYNC_URL="libsql://my-vulse-<org>.turso.io"
export VULSE_DB_AUTH_TOKEN="<token>"
export VULSE_DB_SYNC_INTERVAL="60"   # optional, seconds
```

## Migrating a local database to Turso

Use the bundled script to copy data from a local libSQL file to a Turso
database. The script:

1. runs Vulse migrations against the destination (idempotent),
2. enumerates user tables on the source,
3. copies rows in batches, skipping the internal `_vulse_migrations` table.

```bash
pnpm --filter @vulse/dev db:migrate-to-turso \
  --source file:./dev.db \
  --target "$TURSO_DATABASE_URL" \
  --token  "$TURSO_AUTH_TOKEN"
```

Flags:

- `--truncate` &mdash; delete existing rows on the destination first (use this
  for a clean re-import; otherwise the script appends and may collide on
  primary keys).
- `--dry-run` &mdash; run migrations on the destination, then list the row
  counts that *would* be copied without writing anything.

The script also accepts environment fallbacks: `VULSE_DB_URL` for the source
and `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` for the destination.

## Choosing a deployment

|                      | Local file        | Turso Cloud         | Embedded replica       |
| -------------------- | ----------------- | ------------------- | ---------------------- |
| Best for             | Dev, single host  | Multi-region, ops   | Edge reads + central writes |
| Read latency         | Microseconds      | RTT to Turso        | Microseconds           |
| Write latency        | Microseconds      | RTT to Turso        | RTT to master          |
| Durability / backup  | Your responsibility | Turso-managed     | Turso-managed          |
| Setup                | Zero              | Token + URL         | Token + URL + replica file |
