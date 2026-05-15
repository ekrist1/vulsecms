import { Collection } from '@vulse/core';
import { z } from 'zod';

export default class Posts extends Collection {
  static override handle = 'posts';
  static override label = 'Posts';

  static override schema = z.object({
    title: z
      .string()
      .min(1)
      .meta({ ui: { kind: 'text' } }),
    slug: z
      .string()
      .min(1)
      .meta({ ui: { kind: 'text' } }),
    excerpt: z
      .string()
      .optional()
      .meta({ ui: { kind: 'textarea' } }),
    body: z.any().meta({ ui: { kind: 'blocks' } }),
    publishAt: z
      .string()
      .optional()
      .meta({ ui: { kind: 'date' } }),
    isFeatured: z
      .boolean()
      .default(false)
      .meta({ ui: { kind: 'boolean' } }),
    status: z
      .enum(['draft', 'published'])
      .meta({ ui: { kind: 'select', options: ['draft', 'published'] } }),
    author: z
      .string()
      .optional()
      .meta({ ui: { kind: 'relationship', to: 'authors' } }),
  });
}
