import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeServer } from './node-server.js';

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

async function listen(server: ReturnType<typeof createNodeServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('createNodeServer', () => {
  it('routes api prefixes to the api listener', async () => {
    let apiCalled = 0;
    const server = createNodeServer({
      getListeners: () => ({
        api: (_req, res) => {
          apiCalled++;
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end('{"ok":true}');
        },
        site: null,
      }),
      apiPrefixes: ['/api/'],
      staticRoots: [],
    });
    const url = await listen(server);
    const res = await fetch(`${url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(apiCalled).toBe(1);
  });

  it('returns 404 when no site handler is configured and url is non-api', async () => {
    const server = createNodeServer({
      getListeners: () => ({
        api: (_req, res) => res.end('api'),
        site: null,
      }),
      apiPrefixes: ['/api/'],
      staticRoots: [],
    });
    const url = await listen(server);
    const res = await fetch(`${url}/other`);
    expect(res.status).toBe(404);
  });

  it('falls through to site listener when no api prefix matches', async () => {
    let siteCalled = 0;
    const server = createNodeServer({
      getListeners: () => ({
        api: (_req, res) => res.end('api'),
        site: (_req, res) => {
          siteCalled++;
          res.statusCode = 200;
          res.setHeader('content-type', 'text/html');
          res.end('<!doctype html><p>site</p>');
        },
      }),
      apiPrefixes: ['/api/'],
      staticRoots: [],
    });
    const url = await listen(server);
    const res = await fetch(`${url}/page`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('site');
    expect(siteCalled).toBe(1);
  });
});
