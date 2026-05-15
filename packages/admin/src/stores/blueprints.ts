import { defineStore } from 'pinia';
import { type BlueprintMeta, api } from '../api/client.js';

export const useBlueprintsStore = defineStore('blueprints', {
  state: () => ({
    map: new Map<string, BlueprintMeta>(),
    hydrated: false,
  }),
  getters: {
    list: (s) => [...s.map.values()],
  },
  actions: {
    async hydrate() {
      if (this.hydrated) return;
      await this.refresh();
      this.hydrated = true;
    },
    async refresh() {
      const all = await api.meta();
      this.map = new Map(all.map((bp) => [bp.handle, bp]));
    },
    get(handle: string): BlueprintMeta | undefined {
      return this.map.get(handle);
    },
  },
});
