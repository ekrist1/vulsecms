#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold } from './scaffold.js';

interface Args {
  target?: string;
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { force: false, help: false };
  for (const arg of argv) {
    if (arg === '--force' || arg === '-f') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!arg.startsWith('-') && !out.target) out.target = arg;
  }
  return out;
}

function usage(): void {
  process.stdout.write(`create-vulse — scaffold a new Vulse project.

Usage:
  npm create vulse@latest <project-name>
  pnpm create vulse <project-name>

Options:
  --force, -f   Scaffold into a non-empty directory.
  --help, -h    Show this help.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const target = args.target ?? 'my-vulse-app';
  const absoluteTarget = resolve(process.cwd(), target);
  const projectName = target.split('/').pop() ?? target;

  // Locate the bundled template. In the published package it sits next to dist/.
  const distDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(distDir, '..', 'template'), // published layout: dist/bin.js -> ../template
    resolve(distDir, '..', '..', 'template'), // local dev layout
  ];
  const template = candidates.find(existsSync);
  if (!template) {
    process.stderr.write('error: could not locate scaffold template\n');
    process.exit(1);
  }

  try {
    await scaffold({ target: absoluteTarget, template, projectName, force: args.force });
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `\n  ✔ Vulse project scaffolded at ${absoluteTarget}\n\n  Next steps:\n    cd ${target}\n    pnpm install\n    pnpm dev\n\n`,
  );
}

main();
