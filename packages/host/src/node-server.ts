import { createReadStream } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveStaticAsset } from './static.js';

export type RequestListener = (req: IncomingMessage, res: ServerResponse) => unknown;

export interface StaticRoot {
  root: string;
  base?: string;
  spaFallback?: boolean;
}

export interface CreateNodeServerOptions {
  // Returns the current listeners. We accept a getter (not the values
  // directly) because dev/prod rebuild listeners on blueprint changes.
  getListeners: () => { api: RequestListener };
  // Path prefixes routed to the API listener (e.g. ['/api/', '/_vulse/img/']).
  apiPrefixes: string[];
  // Static asset roots tried in order. Anything that doesn't match an API
  // prefix and isn't a static asset returns 404.
  staticRoots: StaticRoot[];
}

export function createNodeServer(opts: CreateNodeServerOptions): Server {
  return createServer((req, res) => {
    const url = req.url ?? '/';

    if (opts.apiPrefixes.some((p) => url.startsWith(p))) {
      Promise.resolve(opts.getListeners().api(req, res)).catch((err) => {
        console.error(err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
        }
        res.end(JSON.stringify({ error: 'internal' }));
      });
      return;
    }

    for (const r of opts.staticRoots) {
      const asset = resolveStaticAsset({
        root: r.root,
        reqUrl: url,
        ...(r.base !== undefined ? { base: r.base } : {}),
        ...(r.spaFallback !== undefined ? { spaFallback: r.spaFallback } : {}),
      });
      if (asset) {
        res.setHeader('content-type', asset.type);
        createReadStream(asset.path).pipe(res);
        return;
      }
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Not found');
  });
}
