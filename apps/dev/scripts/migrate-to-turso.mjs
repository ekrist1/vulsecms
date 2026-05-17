#!/usr/bin/env node
// Migrate a local Vulse libsql database to Turso (or any libsql-compatible target).
//
// Usage:
//   node scripts/migrate-to-turso.mjs \
//     --source file:./dev.db \
//     --target libsql://my-db.turso.io \
//     --token  $TURSO_AUTH_TOKEN \
//     [--truncate] [--dry-run]
//
// Env fallbacks (useful for CI):
//   VULSE_DB_URL                → --source
//   TURSO_DATABASE_URL          → --target
//   TURSO_AUTH_TOKEN            → --token
import {
  LibsqlAdapter,
  MIGRATIONS_DIR,
  copyAllTables,
  describeConfig,
  runMigrations,
} from '@vulse/db';

function parseArgs(argv) {
  const args = { truncate: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') args.source = argv[++i];
    else if (arg === '--target') args.target = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--truncate') args.truncate = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--source=')) args.source = arg.slice('--source='.length);
    else if (arg.startsWith('--target=')) args.target = arg.slice('--target='.length);
    else if (arg.startsWith('--token=')) args.token = arg.slice('--token='.length);
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function help() {
  console.log(`Usage: node scripts/migrate-to-turso.mjs --source <url> --target <url> --token <token> [--truncate] [--dry-run]

Options:
  --source <url>     libsql URL of the local source DB (e.g. file:./dev.db)
  --target <url>     libsql URL of the destination (e.g. libsql://my-db.turso.io)
  --token  <token>   auth token for the destination (Turso)
  --truncate         delete existing rows on the destination before copying
  --dry-run          run migrations + count rows on source without writing
  -h, --help         show this help

Environment fallbacks:
  VULSE_DB_URL        → --source
  TURSO_DATABASE_URL  → --target
  TURSO_AUTH_TOKEN    → --token
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  const source = args.source ?? process.env.VULSE_DB_URL ?? 'file:./dev.db';
  const target = args.target ?? process.env.TURSO_DATABASE_URL;
  const token = args.token ?? process.env.TURSO_AUTH_TOKEN;

  if (!target) {
    console.error('error: --target (or TURSO_DATABASE_URL) is required.');
    process.exit(2);
  }

  const srcConfig = { url: source };
  const dstConfig = token ? { url: target, authToken: token } : { url: target };

  console.log(`[migrate] source: ${describeConfig(srcConfig).host ?? source}`);
  console.log(`[migrate] target: ${describeConfig(dstConfig).host ?? target}`);

  const src = new LibsqlAdapter(srcConfig);
  const dst = new LibsqlAdapter(dstConfig);

  try {
    await src.exec('PRAGMA foreign_keys = ON');
    console.log('[migrate] running Vulse migrations on target…');
    await runMigrations(dst, MIGRATIONS_DIR);

    if (args.dryRun) {
      const tables = await src.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' ORDER BY name`,
      );
      console.log('[migrate] dry run — rows that would be copied:');
      for (const { name } of tables) {
        if (name === '_vulse_migrations') continue;
        const [{ c }] = await src.query(`SELECT COUNT(*) AS c FROM "${name}"`);
        console.log(`  ${name.padEnd(24)} ${c} rows`);
      }
      return;
    }

    console.log(`[migrate] copying data${args.truncate ? ' (truncating target first)' : ''}…`);
    const result = await copyAllTables(src, dst, {
      truncateTarget: args.truncate,
      onProgress: (e) => {
        if (e.type === 'table-done') console.log(`  ✓ ${e.table.padEnd(24)} ${e.rows} rows`);
        else if (e.type === 'table-skipped')
          console.log(`  - ${e.table.padEnd(24)} skipped (${e.reason})`);
      },
    });
    console.log(`[migrate] done — ${result.totalRows} rows across ${result.tables.length} tables.`);
  } finally {
    await src.close();
    await dst.close();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err?.message ?? err);
  process.exitCode = 1;
});
