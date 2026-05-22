// Typed event bus for cross-module signalling.
//
// Modules and apps add events by augmenting the VulseEvents interface via
// declaration merging:
//
//   declare module '@vulse/core' {
//     interface VulseEvents {
//       'newsletter.subscribed': { email: string };
//     }
//   }

export interface VulseEvents {
  'user.registered': { userId: string; email: string; name: string | null };
  'user.password_reset_requested': {
    userId: string;
    email: string;
    name: string | null;
    resetUrl: string;
  };
  'blueprint.changed': { handle: string; kind: 'create' | 'update' | 'delete' };
}

export type EventListener<K extends keyof VulseEvents> = (
  payload: VulseEvents[K],
) => void | Promise<void>;

export interface EventBus {
  on<K extends keyof VulseEvents>(event: K, listener: EventListener<K>): void;
  off<K extends keyof VulseEvents>(event: K, listener: EventListener<K>): void;
  emit<K extends keyof VulseEvents>(event: K, payload: VulseEvents[K]): Promise<void>;
}

export function createEventBus(): EventBus {
  const listeners = new Map<keyof VulseEvents, Set<(p: unknown) => void | Promise<void>>>();

  return {
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener as (p: unknown) => void | Promise<void>);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener as (p: unknown) => void | Promise<void>);
    },
    async emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          await fn(payload);
        } catch (err) {
          console.error(`[vulse:bus] listener for ${String(event)} threw`, err);
        }
      }
    },
  };
}
