import { defineStore } from 'pinia';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const AUTO_DISMISS_MS = 4000;

let _nextId = 1;
const _timers = new Map<number, ReturnType<typeof setTimeout>>();

function pushToast(
  list: Toast[],
  kind: ToastKind,
  message: string,
  dismissAfter: number | null,
  dismiss: (id: number) => void,
) {
  const id = _nextId++;
  list.push({ id, kind, message });
  if (dismissAfter !== null) {
    const timer = setTimeout(() => dismiss(id), dismissAfter);
    _timers.set(id, timer);
  }
}

export const useToastsStore = defineStore('toasts', {
  state: () => ({
    list: [] as Toast[],
  }),
  actions: {
    success(message: string) {
      pushToast(this.list, 'success', message, AUTO_DISMISS_MS, (id) => this.dismiss(id));
    },
    error(message: string) {
      pushToast(this.list, 'error', message, null, (id) => this.dismiss(id));
    },
    info(message: string) {
      pushToast(this.list, 'info', message, AUTO_DISMISS_MS, (id) => this.dismiss(id));
    },
    dismiss(id: number) {
      const idx = this.list.findIndex((t) => t.id === id);
      if (idx !== -1) this.list.splice(idx, 1);
      const timer = _timers.get(id);
      if (timer) {
        clearTimeout(timer);
        _timers.delete(id);
      }
    },
  },
});
