import type { z } from 'zod';

export abstract class Collection {
  static handle: string;
  static label: string;
  static schema: z.ZodObject<z.ZodRawShape>;
  /** Enable parent/child nesting for entries in this collection. */
  static tree?: boolean;
  /** Optional maximum nesting depth (requires `tree = true`). */
  static maxDepth?: number;
}
