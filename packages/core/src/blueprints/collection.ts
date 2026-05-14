import type { z } from 'zod';

export abstract class Collection {
  static handle: string;
  static label: string;
  static schema: z.ZodObject<z.ZodRawShape>;
}
