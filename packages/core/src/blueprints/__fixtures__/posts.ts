import { z } from 'zod';
import { Collection } from '../collection.js';

export default class Posts extends Collection {
  static override handle = 'posts';
  static override label = 'Posts';
  static override schema = z.object({
    title: z.string().min(1).meta({ ui: { kind: 'text' } }),
    body: z.array(z.any()).meta({ ui: { kind: 'blocks' } }),
  });
}
