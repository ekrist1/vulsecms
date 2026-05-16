import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastsStore } from '../toasts.js';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useToastsStore', () => {
  it('success() pushes an auto-dismissing toast', () => {
    const t = useToastsStore();
    t.success('Saved');
    expect(t.list).toHaveLength(1);
    expect(t.list[0]).toMatchObject({ kind: 'success', message: 'Saved' });
    vi.advanceTimersByTime(4000);
    expect(t.list).toHaveLength(0);
  });

  it('error() pushes a persistent toast', () => {
    const t = useToastsStore();
    t.error('Boom');
    expect(t.list).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(t.list).toHaveLength(1);
  });

  it('info() pushes an auto-dismissing toast', () => {
    const t = useToastsStore();
    t.info('FYI');
    expect(t.list).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(t.list).toHaveLength(0);
  });

  it('dismiss() removes by id and cancels the auto-dismiss timer', () => {
    const t = useToastsStore();
    t.success('one');
    t.success('two');
    const firstId = t.list[0]!.id;
    t.dismiss(firstId);
    expect(t.list.map((x) => x.message)).toEqual(['two']);
    // Advancing past auto-dismiss should clear the second one too without throwing.
    vi.advanceTimersByTime(4000);
    expect(t.list).toHaveLength(0);
  });

  it('assigns monotonically increasing ids', () => {
    const t = useToastsStore();
    t.success('a');
    t.success('b');
    t.success('c');
    const ids = t.list.map((x) => x.id);
    expect(ids[1]).toBeGreaterThan(ids[0]!);
    expect(ids[2]).toBeGreaterThan(ids[1]!);
  });
});
