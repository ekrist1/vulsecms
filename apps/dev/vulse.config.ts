import { fileURLToPath } from 'node:url';

export default {
  blueprintsDir: fileURLToPath(new URL('./blueprints/', import.meta.url)),
  database: { url: 'file:./dev.db' },
};
