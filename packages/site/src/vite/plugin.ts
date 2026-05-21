import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

const VIRTUAL_MANIFEST_ID = 'virtual:vulse-site-manifest';
const RESOLVED_MANIFEST_ID = `\0${VIRTUAL_MANIFEST_ID}`;
const VIRTUAL_DEV_CLIENT_ID = 'virtual:vulse-site-dev-client';
const RESOLVED_DEV_CLIENT_ID = `\0${VIRTUAL_DEV_CLIENT_ID}`;

export interface VulseSitePluginOptions {
  dir?: string;
  clientBase?: string;
}

export interface ScannedPage {
  file: string;
  path: string;
  kind: 'page' | 'list' | 'entry';
  layout: string;
  collection?: string;
}

export interface ScannedLayout {
  name: string;
  file: string;
}

export interface ScannedSite {
  dir: string;
  pages: ScannedPage[];
  layouts: ScannedLayout[];
}

function normalizeSlashes(value: string): string {
  return value.split(sep).join('/');
}

function toImportPath(file: string): string {
  return normalizeSlashes(file);
}

function walkVueFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkVueFiles(full));
    else if (stat.isFile() && extname(full) === '.vue') out.push(full);
  }
  return out.sort();
}

function segmentPath(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/\.(vue|ts|js)$/, ''))
    .join('/');
}

export function extractPageLayout(source: string): string {
  const match = source.match(/definePageMeta\s*\(\s*\{[\s\S]*?layout\s*:\s*['"]([^'"]+)['"]/m);
  return match?.[1] ?? 'default';
}

export function routeFromPageFile(pagesDir: string, file: string): ScannedPage | null {
  const relativePath = normalizeSlashes(relative(pagesDir, file));
  const withoutExt = relativePath.replace(/\.vue$/, '');
  const parts = withoutExt.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const source = readFileSync(file, 'utf8');
  const layout = extractPageLayout(source);
  const filename = parts.at(-1);

  if (parts.length === 1 && filename === 'index') {
    return { file, path: '/', kind: 'page', layout };
  }

  if (parts.length === 1) {
    return { file, path: `/${segmentPath(withoutExt)}`, kind: 'page', layout };
  }

  const collection = parts.at(-2);
  if (!collection) return null;

  if (filename === 'index') {
    return {
      file,
      path: `/${segmentPath(dirname(withoutExt))}`,
      kind: 'list',
      collection,
      layout,
    };
  }

  if (filename === 'show') {
    return {
      file,
      path: `/${segmentPath(dirname(withoutExt))}/:slug`,
      kind: 'entry',
      collection,
      layout,
    };
  }

  return { file, path: `/${segmentPath(withoutExt)}`, kind: 'page', layout };
}

export function scanSite(dir: string): ScannedSite {
  const pagesDir = resolve(dir, 'pages');
  const layoutsDir = resolve(dir, 'layouts');
  const pages = walkVueFiles(pagesDir)
    .map((file) => routeFromPageFile(pagesDir, file))
    .filter((page): page is ScannedPage => page !== null);
  const layouts = walkVueFiles(layoutsDir).map((file) => ({
    name: basename(file, '.vue'),
    file,
  }));

  return { dir, pages, layouts };
}

function validateSite(scan: ScannedSite): void {
  const paths = new Set<string>();
  for (const page of scan.pages) {
    if (paths.has(page.path)) {
      throw new Error(`[vulse:site] duplicate route path "${page.path}" in ${scan.dir}`);
    }
    paths.add(page.path);
  }

  const layoutNames = new Set(scan.layouts.map((layout) => layout.name));
  for (const page of scan.pages) {
    if (page.layout !== 'default' && !layoutNames.has(page.layout)) {
      throw new Error(
        `[vulse:site] page ${page.file} uses missing layout "${page.layout}". Add site/layouts/${page.layout}.vue.`,
      );
    }
  }
}

function manifestModule(scan: ScannedSite): string {
  validateSite(scan);
  const imports: string[] = [];
  const routeItems: string[] = [];
  const layoutItems: string[] = [];

  scan.pages.forEach((page, index) => {
    const name = `Page${index}`;
    const props = [
      `path: ${JSON.stringify(page.path)}`,
      `kind: ${JSON.stringify(page.kind)}`,
      `component: ${name}`,
      `layout: ${JSON.stringify(page.layout)}`,
      page.collection ? `collection: ${JSON.stringify(page.collection)}` : '',
      `source: ${JSON.stringify(normalizeSlashes(relative(scan.dir, page.file)))}`,
    ].filter(Boolean);
    imports.push(`import ${name} from ${JSON.stringify(toImportPath(page.file))};`);
    routeItems.push(`{ ${props.join(', ')} }`);
  });

  scan.layouts.forEach((layout, index) => {
    const name = `Layout${index}`;
    imports.push(`import ${name} from ${JSON.stringify(toImportPath(layout.file))};`);
    layoutItems.push(`${JSON.stringify(layout.name)}: ${name}`);
  });

  return `${imports.join('\n')}
export const projectRoutes = [${routeItems.join(',\n')}];
export const projectLayouts = { ${layoutItems.join(', ')} };
`;
}

function stripPageMeta(source: string): string {
  return source.replace(/definePageMeta\s*\(\s*\{[\s\S]*?\}\s*\)\s*;?/m, 'void 0;');
}

function isInside(file: string, dir: string): boolean {
  const rel = relative(dir, file);
  return !!rel && !rel.startsWith('..') && !rel.startsWith('/');
}

function invalidateVirtual(server: ViteDevServer, id: string) {
  const mod = server.moduleGraph.getModuleById(id);
  if (mod) server.moduleGraph.invalidateModule(mod);
}

export function vulseSitePlugin(options: VulseSitePluginOptions = {}): Plugin {
  let root = process.cwd();
  let siteDir = '';
  let clientBase = options.clientBase ?? '/_vulse/site/';

  return {
    name: 'vulse:site',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      siteDir = resolve(root, options.dir ?? 'site');
      clientBase = clientBase.endsWith('/') ? clientBase : `${clientBase}/`;
    },

    resolveId(id) {
      if (id === VIRTUAL_MANIFEST_ID) return RESOLVED_MANIFEST_ID;
      if (id === VIRTUAL_DEV_CLIENT_ID) return RESOLVED_DEV_CLIENT_ID;
      return null;
    },

    load(id) {
      if (id === RESOLVED_MANIFEST_ID) return manifestModule(scanSite(siteDir));
      if (id === RESOLVED_DEV_CLIENT_ID) return 'import "@vulse/site/project-client";';
      return null;
    },

    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (file.endsWith('.vue') && isInside(file, siteDir) && code.includes('definePageMeta')) {
        return { code: stripPageMeta(code), map: null };
      }
      return null;
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        if (!req.url.startsWith(`${clientBase}entry-client.js`)) return next();

        const result = await server.transformRequest(VIRTUAL_DEV_CLIENT_ID);
        if (!result) return next();
        res.setHeader('content-type', 'application/javascript; charset=utf-8');
        res.end(result.code);
      });
    },

    handleHotUpdate(ctx) {
      if (!siteDir || !isInside(ctx.file, siteDir)) return;
      invalidateVirtual(ctx.server, RESOLVED_MANIFEST_ID);
      invalidateVirtual(ctx.server, RESOLVED_DEV_CLIENT_ID);
    },
  };
}
