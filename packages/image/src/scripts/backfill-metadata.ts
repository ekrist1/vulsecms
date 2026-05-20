#!/usr/bin/env node
import { LibsqlAdapter, MIGRATIONS_DIR, databaseConfigFromEnv, runMigrations } from '@vulse/db';
import { fetchAssetSource } from '../fetch-source.js';
import { probeMetadata } from '../metadata.js';

async function main(): Promise<void> {
  const db = new LibsqlAdapter(databaseConfigFromEnv());
  await runMigrations(db, MIGRATIONS_DIR);

  const rows = await db.query<{ id: string }>(
    `SELECT id FROM assets
      WHERE content_type LIKE 'image/%' AND image_width IS NULL`,
  );
  console.log(`[backfill] found ${rows.length} image asset(s) without dims`);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const source = await fetchAssetSource(db, row.id);
      if (!source) {
        failed++;
        continue;
      }
      const meta = await probeMetadata(source.buffer);
      if (!meta) {
        failed++;
        continue;
      }
      await db.exec(`UPDATE assets SET image_width = ?, image_height = ? WHERE id = ?`, [
        meta.width,
        meta.height,
        row.id,
      ]);
      ok++;
    } catch (err) {
      console.warn(`[backfill] ${row.id}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`[backfill] done: ok=${ok} failed=${failed}`);
}

await main();
