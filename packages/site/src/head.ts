import type { ResolvedHead, SiteConfig, SiteInitialState, SiteScript } from './types.js';

const DEFAULT_TITLE = 'Vulse site';
const DEFAULT_LOCALE = 'en';

const TITLE_FIELDS = ['seoTitle', 'seo_title', 'title', 'headline'];
const DESCRIPTION_FIELDS = ['seoDescription', 'seo_description', 'description', 'excerpt'];
const IMAGE_FIELDS = ['seoImage', 'seo_image', 'ogImage', 'og_image', 'coverImage', 'cover_image'];
const CANONICAL_FIELDS = ['canonicalUrl', 'canonical_url'];

function firstString(content: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = content[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstStringOrObject(content: Record<string, unknown>, fields: string[]): unknown {
  for (const field of fields) {
    const value = content[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') return value;
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyTitleTemplate(title: string, template: string | undefined): string {
  if (!template) return title;
  return template.includes('%s') ? template.replace('%s', title) : `${title}${template}`;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeAbsoluteUrl(value: string | undefined, site: SiteConfig): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    if (!site.url) return value;
    return new URL(value, `${withoutTrailingSlash(site.url)}/`).toString();
  }
}

function canonicalFromRequest(
  site: SiteConfig,
  requestUrl: string | URL | undefined,
): string | undefined {
  if (!requestUrl) return site.url;

  const parsed =
    typeof requestUrl === 'string'
      ? site.url
        ? new URL(requestUrl, `${withoutTrailingSlash(site.url)}/`)
        : requestUrl.startsWith('http://') || requestUrl.startsWith('https://')
          ? new URL(requestUrl)
          : null
      : new URL(requestUrl.toString());

  if (!parsed) return undefined;

  const pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
  const base = site.url ? withoutTrailingSlash(site.url) : parsed.origin;
  return `${base}${pathname}`;
}

function jsonLdValues(content: Record<string, unknown>): unknown[] {
  const values = [content.jsonLd, content.json_ld, content.structuredData, content.structured_data];
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) return value;
    if (isPlainRecord(value)) return [value];
  }
  return [];
}

function shouldNoindex(
  state: SiteInitialState,
  content: Record<string, unknown>,
  requestUrl?: string | URL,
): boolean {
  if (state.route.type === 'not-found') return true;
  if (content.noindex === true) return true;
  if (!requestUrl) return false;

  const parsed =
    typeof requestUrl === 'string'
      ? new URL(requestUrl, 'http://localhost')
      : new URL(requestUrl.toString());
  return parsed.searchParams.has('vulse-preview') || parsed.searchParams.get('preview') === '1';
}

export function resolveHead(
  state: SiteInitialState,
  site: SiteConfig = {},
  requestUrl?: string | URL,
): ResolvedHead {
  const content = state.entry?.content ?? {};
  const rawTitle =
    firstString(content, TITLE_FIELDS) ?? site.defaultTitle ?? site.name ?? DEFAULT_TITLE;
  const title = applyTitleTemplate(rawTitle, site.titleTemplate);
  const description = firstString(content, DESCRIPTION_FIELDS) ?? site.defaultDescription;
  const rawImage = firstStringOrObject(content, IMAGE_FIELDS) ?? site.defaultImage;
  const resolved = site.resolveImage ? site.resolveImage(rawImage, site) : undefined;
  const image =
    resolved ?? normalizeAbsoluteUrl(typeof rawImage === 'string' ? rawImage : undefined, site);
  const canonical =
    normalizeAbsoluteUrl(firstString(content, CANONICAL_FIELDS), site) ??
    canonicalFromRequest(site, requestUrl);
  const robots = shouldNoindex(state, content, requestUrl)
    ? 'noindex, nofollow'
    : (site.seo?.robots ?? 'index, follow');
  const type = state.route.type === 'entry' ? 'article' : 'website';
  const twitterCard = site.seo?.twitterCard ?? (image ? 'summary_large_image' : 'summary');

  const meta: ResolvedHead['meta'] = [
    { name: 'robots', content: robots },
    { property: 'og:type', content: type },
    { property: 'og:title', content: title },
    { name: 'twitter:card', content: twitterCard },
    { name: 'twitter:title', content: title },
  ];

  if (description) {
    meta.push(
      { name: 'description', content: description },
      { property: 'og:description', content: description },
      { name: 'twitter:description', content: description },
    );
  }

  if (site.name) meta.push({ property: 'og:site_name', content: site.name });
  if (canonical) meta.push({ property: 'og:url', content: canonical });
  if (image) {
    meta.push({ property: 'og:image', content: image }, { name: 'twitter:image', content: image });
  }

  return {
    htmlAttrs: { lang: site.locale ?? DEFAULT_LOCALE },
    title,
    meta,
    links: canonical ? [{ rel: 'canonical', href: canonical }] : [],
    scripts: site.scripts ?? [],
    jsonLd: jsonLdValues(content),
  };
}

export function scriptsForEnvironment(
  scripts: SiteScript[],
  environment: string | undefined,
): SiteScript[] {
  const env = environment ?? process.env.NODE_ENV ?? 'development';
  return scripts.filter((script) => !script.productionOnly || env === 'production');
}
