import { Collection } from '@vulse/core';
import { z } from 'zod';

export default class Authors extends Collection {
  static override handle = 'authors';
  static override label = 'Authors';

  static override schema = z.object({
    name: z
      .string()
      .min(1)
      .meta({ ui: { kind: 'text' } }),
    bio: z
      .string()
      .optional()
      .meta({ ui: { kind: 'textarea' } }),
  });
}
