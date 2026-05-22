import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

export interface ScaffoldOptions {
  target: string;
  template: string;
  projectName: string;
  force?: boolean;
}

const TEMPLATE_SUFFIX = '.tmpl';
const PLACEHOLDER = /__PROJECT_NAME__/g;

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  ensureSafeTarget(opts.target, opts.force ?? false);
  walk(opts.template, (absPath) => {
    const rel = relative(opts.template, absPath);
    const isTemplate = rel.endsWith(TEMPLATE_SUFFIX);
    const outRel = isTemplate ? rel.slice(0, -TEMPLATE_SUFFIX.length) : rel;
    const outPath = join(opts.target, outRel);
    mkdirSync(dirname(outPath), { recursive: true });
    if (isTemplate) {
      const body = readFileSync(absPath, 'utf8').replace(PLACEHOLDER, opts.projectName);
      writeFileSync(outPath, body);
    } else {
      copyFileSync(absPath, outPath);
    }
  });
}

function ensureSafeTarget(target: string, force: boolean): void {
  mkdirSync(target, { recursive: true });
  const entries = readdirSync(target);
  if (entries.length > 0 && !force) {
    throw new Error(`target directory is not empty: ${target} (use --force to overwrite)`);
  }
}

function walk(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, visit);
    } else {
      visit(path);
    }
  }
}
