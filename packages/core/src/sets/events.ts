import { EventEmitter } from 'node:events';

export const setsEvents = new EventEmitter();
export type SetsChangeEvent = { handle: string; kind: 'create' | 'update' | 'delete' };
