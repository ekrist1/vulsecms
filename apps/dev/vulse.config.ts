import { fileURLToPath } from 'node:url';
import type { SiteConfig } from '@vulse/site/server';

const site = {
  url: 'http://localhost:3000',
  name: 'Vulse Dev',
  locale: 'en',
  titleTemplate: '%s | Vulse Dev',
  defaultTitle: 'Vulse Dev',
  defaultDescription: 'A local Vulse development site.',
} satisfies SiteConfig;

export default {
  blueprintsDir: fileURLToPath(new URL('./blueprints/', import.meta.url)),
  database: { url: 'file:./dev.db' },
  site,
};
