import { z } from 'zod';
import { Collection } from '../collection.js';

export default class DraftsPosts extends Collection {
  static override handle = 'drafts-posts';
  static override label = 'Drafts Posts';
  static override drafts = true;
  static override schema = z.object({
    title: z
      .string()
      .min(1)
      .meta({ ui: { kind: 'text' } }),
    slug: z
      .string()
      .min(1)
      .meta({ ui: { kind: 'text' } }),
  });
}
