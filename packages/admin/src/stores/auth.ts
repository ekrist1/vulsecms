import { defineStore } from 'pinia';
import { api, type AuthUser } from '../api/client.js';

export type Action = 'read' | 'create' | 'update' | 'delete' | 'publish';
export type PermsMap = Record<string, Action[]>;

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as AuthUser | null,
    perms: {} as PermsMap,
    hydrated: false,
  }),
  actions: {
    async hydrate() {
      const me = await api.me();
      this.user = me.user;
      this.perms = me.perms as PermsMap;
      this.hydrated = true;
    },
    async login(email: string, password: string) {
      await api.login(email, password);
      await this.hydrate();
    },
    async logout() {
      await api.logout();
      this.user = null;
      this.perms = {};
    },
    can(collectionHandle: string, action: Action): boolean {
      if (!this.user) return false;
      if (this.user.isSuper) return true;
      return this.perms[collectionHandle]?.includes(action) ?? false;
    },
  },
});
