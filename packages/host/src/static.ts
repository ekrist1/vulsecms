import { statSync } from 'node:fs';
import { join } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface ResolveStaticOptions {
  root: string;
  reqUrl: string;
  base?: string;
  spaFallback?: boolean;
}

export interface StaticAsset {
  path: string;
  type: string;
}

export function resolveStaticAsset(opts: ResolveStaticOptions): StaticAsset | null {
  const pathname = decodeURIComponent(opts.reqUrl.split('?')[0] ?? '/');
  if (opts.base && !pathname.startsWith(opts.base)) return null;
  const stripped = opts.base ? pathname.slice(opts.base.length) : pathname;
  const safePath = stripped.replace(/^\/+/, '').replace(/\.\./g, '');
  const candidate = safePath ? join(opts.root, safePath) : join(opts.root, 'index.html');
  try {
    const stat = statSync(candidate);
    if (stat.isFile()) {
      const ext = candidate.slice(candidate.lastIndexOf('.'));
      return { path: candidate, type: MIME_TYPES[ext] ?? 'application/octet-stream' };
    }
  } catch {
    // fall through to spa fallback
  }
  if (!opts.spaFallback) return null;
  try {
    const fallback = join(opts.root, 'index.html');
    const stat = statSync(fallback);
    if (stat.isFile()) return { path: fallback, type: 'text/html; charset=utf-8' };
  } catch {
    // not found
  }
  return null;
}
