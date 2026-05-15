import { EventEmitter } from 'node:events';

// Singleton event bus for blueprint changes. The Vite dev plugin and prod
// server both subscribe so they can reload blueprints after admin mutations.
export const blueprintEvents = new EventEmitter();

export type BlueprintChangeEvent = { handle: string; kind: 'create' | 'update' | 'delete' };
