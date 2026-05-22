// An example blueprint. Blueprints define the shape of your content
// collections — fields, validations, and how entries render. Edit, delete,
// or add as many as you like.
import { Collection } from '@vulse/core';

export default new Collection('posts')
  .title('Posts')
  .field('title', { type: 'text', required: true })
  .field('slug', { type: 'text', required: true })
  .field('body', { type: 'rich-text' });
