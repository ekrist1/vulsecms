#!/usr/bin/env node
// Copy a Vulse Turso database down to a local libsql file.
//
// Usage:
//   node scripts/pull-from-turso.mjs \
//     --source libsql://my-db.turso.io \
//     --token  $TURSO_AUTH_TOKEN \
//     --target file:./dev.db \
//     [--force] [--no-truncate] [--dry-run]
//
// Env fallbacks:
//   TURSO_DATABASE_URL          → --source
//   TURSO_AUTH_TOKEN            → --token
//   VULSE_DB_URL                → --target
import { existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  LibsqlAdapter,
  MIGRATIONS_DIR,
  copyAllTables,
  describeConfig,
  runMigrations,
} from '@vulse/db';

function parseArgs(argv) {
  const args = { truncate: true, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') args.source = argv[++i];
    else if (arg === '--target') args.target = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--no-truncate') args.truncate = false;
    else if (arg === '--truncate') args.truncate = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force' || arg === '-f') args.force = true;
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
  console.log(`Usage: node scripts/pull-from-turso.mjs --source <url> --token <token> --target <file-url> [--force] [--no-truncate] [--dry-run]

Copies a Turso (or any remote libsql) database into a local libsql file so
you can develop against a replica of production data.

Options:
  --source <url>     libsql URL of the remote source (e.g. libsql://my-db.turso.io)
  --token  <token>   auth token for the source (Turso)
  --target <url>     destination libsql URL — usually file:./dev.db
  --force, -f        overwrite an existing local target without prompting
  --no-truncate      keep existing rows on the target (default truncates first)
  --dry-run          run migrations + count rows on source without writing
  -h, --help         show this help

Environment fallbacks:
  TURSO_DATABASE_URL  → --source
  TURSO_AUTH_TOKEN    → --token
  VULSE_DB_URL        → --target
`);
}

function localFilePath(url) {
  if (typeof url !== 'string') return null;
  if (!url.startsWith('file:')) return null;
  const rest = url.slice('file:'.length);
  if (rest.startsWith('//')) {
    try {
      return fileURLToPath(url);
    } catch {
      return null;
    }
  }
  return rest;
}

async function confirmOverwrite(targetPath, sizeBytes) {
  const size = sizeBytes >= 1024 * 1024
    ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MiB`
    : `${(sizeBytes / 1024).toFixed(1)} KiB`;
  console.warn(`\n⚠️  Target database already exists: ${targetPath} (${size}).`);
  console.warn('   Pulling from Turso will OVERWRITE its contents.');
  if (!input.isTTY) {
    console.error('   Refusing to overwrite non-interactively. Pass --force to confirm.');
    return false;
  }
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question('   Type "yes" to continue: ')).trim().toLowerCase();
    return answer === 'yes' || answer === 'y';
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  const source = args.source ?? process.env.TURSO_DATABASE_URL;
  const token = args.token ?? process.env.TURSO_AUTH_TOKEN;
  const target = args.target ?? process.env.VULSE_DB_URL ?? 'file:./dev.db';

  if (!source) {
    console.error('error: --source (or TURSO_DATABASE_URL) is required.');
    process.exit(2);
  }
  if (!token) {
    console.error('error: --token (or TURSO_AUTH_TOKEN) is required for a remote source.');
    process.exit(2);
  }

  const targetPath = localFilePath(target);
  if (targetPath && existsSync(targetPath)) {
    if (!args.force && !args.dryRun) {
      const ok = await confirmOverwrite(targetPath, statSync(targetPath).size);
      if (!ok) {
        console.error('[pull] aborted — target was not overwritten.');
        process.exit(1);
      }
    } else if (args.force) {
      console.log(`[pull] --force: overwriting existing target ${targetPath}`);
    }
  }

  const srcConfig = { url: source, authToken: token };
  const dstConfig = { url: target };

  console.log(`[pull] source: ${describeConfig(srcConfig).host ?? source}`);
  console.log(`[pull] target: ${describeConfig(dstConfig).host ?? target}`);

  const src = new LibsqlAdapter(srcConfig);
  const dst = new LibsqlAdapter(dstConfig);

  try {
    await dst.exec('PRAGMA foreign_keys = ON');
    console.log('[pull] running Vulse migrations on target…');
    await runMigrations(dst, MIGRATIONS_DIR);

    if (args.dryRun) {
      const tables = await src.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' ORDER BY name`,
      );
      console.log('[pull] dry run — rows that would be copied:');
      for (const { name } of tables) {
        if (name === '_vulse_migrations') continue;
        const [{ c }] = await src.query(`SELECT COUNT(*) AS c FROM "${name}"`);
        console.log(`  ${name.padEnd(24)} ${c} rows`);
      }
      return;
    }

    console.log(`[pull] copying data${args.truncate ? ' (truncating target first)' : ''}…`);
    const result = await copyAllTables(src, dst, {
      truncateTarget: args.truncate,
      onProgress: (e) => {
        if (e.type === 'table-done') console.log(`  ✓ ${e.table.padEnd(24)} ${e.rows} rows`);
        else if (e.type === 'table-skipped')
          console.log(`  - ${e.table.padEnd(24)} skipped (${e.reason})`);
      },
    });
    console.log(`[pull] done — ${result.totalRows} rows across ${result.tables.length} tables.`);
  } finally {
    await src.close();
    await dst.close();
  }
}

main().catch((err) => {
  console.error('[pull] failed:', err?.message ?? err);
  process.exitCode = 1;
});
