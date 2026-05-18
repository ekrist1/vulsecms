import { Collection } from '@vulse/core';
import { z } from 'zod';

export default class Pages extends Collection {
  static override handle = 'pages';
  static override label = 'Pages';
  static override tree = true;
  static override maxDepth = 4;

  static override schema = z.object({
    title: z
      .string()
      .min(1)
      .meta({ ui: { kind: 'text' } }),
    slug: z
      .string()
      .min(1)
      .meta({ ui: { kind: 'text' } }),
    body: z.any().meta({ ui: { kind: 'blocks' } }),
  });
}
