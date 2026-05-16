import { defineStore } from 'pinia';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const AUTO_DISMISS_MS = 4000;

export const useToastsStore = defineStore('toasts', {
  state: () => ({
    list: [] as Toast[],
    _nextId: 1,
    _timers: new Map<number, ReturnType<typeof setTimeout>>(),
  }),
  actions: {
    success(message: string) {
      this._push('success', message, AUTO_DISMISS_MS);
    },
    error(message: string) {
      this._push('error', message, null);
    },
    info(message: string) {
      this._push('info', message, AUTO_DISMISS_MS);
    },
    dismiss(id: number) {
      const idx = this.list.findIndex((t) => t.id === id);
      if (idx !== -1) this.list.splice(idx, 1);
      const timer = this._timers.get(id);
      if (timer) {
        clearTimeout(timer);
        this._timers.delete(id);
      }
    },
    _push(kind: ToastKind, message: string, dismissAfter: number | null) {
      const id = this._nextId++;
      this.list.push({ id, kind, message });
      if (dismissAfter !== null) {
        const timer = setTimeout(() => this.dismiss(id), dismissAfter);
        this._timers.set(id, timer);
      }
    },
  },
});
