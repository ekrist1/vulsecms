import { renderToString } from '@vue/server-renderer';
import { createSiteApp } from './app.js';
import { resolveHead, scriptsForEnvironment } from './head.js';
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

function escapeScriptContent(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script');
}

function renderAttrs(attrs: Record<string, string | boolean | undefined>): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== false && value !== undefined)
    .map(([key, value]) => {
      if (value === true) return ` ${escapeHtml(key)}`;
      return ` ${escapeHtml(key)}="${escapeHtml(String(value))}"`;
    })
    .join('');
}

function renderMetaTags(head: ReturnType<typeof resolveHead>): string {
  return head.meta
    .map((tag) => {
      const attrs = {
        ...(tag.name ? { name: tag.name } : {}),
        ...(tag.property ? { property: tag.property } : {}),
        content: tag.content,
      };
      return `    <meta${renderAttrs(attrs)} />`;
    })
    .join('\n');
}

function renderLinkTags(head: ReturnType<typeof resolveHead>): string {
  return head.links
    .map((tag) => `    <link${renderAttrs({ rel: tag.rel, href: tag.href })} />`)
    .join('\n');
}

function renderJsonLd(head: ReturnType<typeof resolveHead>): string {
  return head.jsonLd
    .map(
      (value) =>
        `    <script type="application/ld+json">${escapeScriptContent(JSON.stringify(value) ?? 'null')}</script>`,
    )
    .join('\n');
}

function renderSiteScripts(
  head: ReturnType<typeof resolveHead>,
  position: 'head' | 'bodyOpen' | 'bodyClose',
  environment: string | undefined,
): string {
  return scriptsForEnvironment(head.scripts, environment)
    .filter((script) => script.position === position)
    .flatMap((script) => {
      const attrs = { 'data-vulse-script': script.id, ...(script.attrs ?? {}) };
      const tags: string[] = [];
      if (script.src) {
        tags.push(`    <script${renderAttrs({ ...attrs, src: script.src })}></script>`);
      }
      if (script.content) {
        tags.push(
          `    <script${renderAttrs(attrs)}>${escapeScriptContent(script.content)}</script>`,
        );
      }
      if (script.noscript) {
        tags.push(
          `    <noscript data-vulse-script="${escapeHtml(script.id)}">${script.noscript}</noscript>`,
        );
      }
      return tags;
    })
    .join('\n');
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
  const head = resolveHead(initialState, options.site, options.requestUrl ?? url);
  const state = serializeState(initialState);
  const clientEntry = options.clientEntry ?? DEFAULT_CLIENT_ENTRY;
  const stylesheet = options.stylesheet ?? DEFAULT_STYLESHEET;
  const metaTags = renderMetaTags(head);
  const linkTags = renderLinkTags(head);
  const jsonLdTags = renderJsonLd(head);
  const headScripts = renderSiteScripts(head, 'head', options.environment);
  const bodyOpenScripts = renderSiteScripts(head, 'bodyOpen', options.environment);
  const bodyCloseScripts = renderSiteScripts(head, 'bodyClose', options.environment);

  return `<!doctype html>
<html${renderAttrs(head.htmlAttrs)}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>${escapeHtml(head.title)}</title>
${metaTags ? `${metaTags}\n` : ''}${linkTags ? `${linkTags}\n` : ''}${jsonLdTags ? `${jsonLdTags}\n` : ''}${headScripts ? `${headScripts}\n` : ''}    <link rel="stylesheet" href="${stylesheet}" />
  </head>
  <body>
${bodyOpenScripts ? `${bodyOpenScripts}\n` : ''}    <div id="app">${appHtml}</div>
    <script>window.__VULSE_SITE_STATE__=${state}</script>
    <script type="module" src="${clientEntry}"></script>
${bodyCloseScripts ? `${bodyCloseScripts}\n` : ''}  </body>
</html>`;
}
