import { z } from 'zod';
import { Collection } from '../collection.js';

export default class Posts extends Collection {
  static override handle = 'posts';
  static override label = 'Posts';
  static override schema = z.object({
    title: z
      .string()
      .min(1)
      .meta({ ui: { kind: 'text' } }),
    body: z.array(z.any()).meta({ ui: { kind: 'blocks' } }),
    status: z
      .enum(['draft', 'published', 'scheduled'])
      .optional()
      .meta({ ui: { kind: 'select', options: ['draft', 'published', 'scheduled'] } }),
    publishedAt: z
      .string()
      .optional()
      .meta({ ui: { kind: 'date' } }),
    featured: z
      .boolean()
      .optional()
      .meta({ ui: { kind: 'boolean' } }),
  });
}
