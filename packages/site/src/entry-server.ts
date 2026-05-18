import { renderToString } from '@vue/server-renderer';
import { createSiteApp } from './app.js';
import type { RenderPageOptions, SiteInitialState } from './types.js';

const DEFAULT_CLIENT_ENTRY = '/_vulse/site/entry-client.js';
const DEFAULT_STYLESHEET = '/_vulse/site/style.css';

function serializeState(state: SiteInitialState): string {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function renderPage(
  url: string,
  initialState: SiteInitialState,
  options: RenderPageOptions = {},
): Promise<string> {
  const { app, router } = createSiteApp({ history: 'memory', initialState });
  await router.push(url);
  await router.isReady();

  const appHtml = await renderToString(app);
  const title =
    typeof initialState.entry?.content.title === 'string'
      ? initialState.entry.content.title
      : typeof initialState.entry?.content.headline === 'string'
        ? initialState.entry.content.headline
        : 'Vulse site';
  const state = serializeState(initialState);
  const clientEntry = options.clientEntry ?? DEFAULT_CLIENT_ENTRY;
  const stylesheet = options.stylesheet ?? DEFAULT_STYLESHEET;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${stylesheet}" />
  </head>
  <body>
    <div id="app">${appHtml}</div>
    <script>window.__VULSE_SITE_STATE__=${state}</script>
    <script type="module" src="${clientEntry}"></script>
  </body>
</html>`;
}
