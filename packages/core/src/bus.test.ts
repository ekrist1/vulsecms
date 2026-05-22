import { describe, expect, it, vi } from 'vitest';
import { type VulseEvents, createEventBus } from './bus.js';

describe('createEventBus', () => {
  it('delivers payload to a typed listener', async () => {
    const bus = createEventBus();
    const seen: VulseEvents['user.registered'][] = [];
    bus.on('user.registered', (payload) => {
      seen.push(payload);
    });

    await bus.emit('user.registered', { userId: 'u1', email: 'a@b.com', name: null });

    expect(seen).toEqual([{ userId: 'u1', email: 'a@b.com', name: null }]);
  });

  it('awaits async listeners before resolving emit', async () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.on('user.registered', async (p) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(`listener:${p.userId}`);
    });

    await bus.emit('user.registered', { userId: 'u1', email: 'a@b.com', name: null });
    order.push('after-emit');

    expect(order).toEqual(['listener:u1', 'after-emit']);
  });

  it('off() removes a listener', async () => {
    const bus = createEventBus();
    const fn = vi.fn();
    bus.on('user.registered', fn);
    bus.off('user.registered', fn);
    await bus.emit('user.registered', { userId: 'u', email: 'e', name: null });
    expect(fn).not.toHaveBeenCalled();
  });

  it('isolates listener errors so other listeners still run', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('user.registered', () => {
      throw new Error('boom');
    });
    bus.on('user.registered', (p) => {
      seen.push(p.userId);
    });
    await bus.emit('user.registered', { userId: 'u1', email: 'e', name: null });
    expect(seen).toEqual(['u1']);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
