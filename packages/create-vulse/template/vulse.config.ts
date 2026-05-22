import { fileURLToPath } from 'node:url';
import type { SiteConfig } from '@vulse/site/server';

const site = {
  url: 'http://localhost:3000',
  name: 'My Vulse Site',
  locale: 'en',
  defaultTitle: 'My Vulse Site',
  defaultDescription: 'A Vulse project.',
} satisfies SiteConfig;

export default {
  blueprintsDir: fileURLToPath(new URL('./blueprints/', import.meta.url)),
  database: { url: 'file:./vulse.db' },
  site,
};
