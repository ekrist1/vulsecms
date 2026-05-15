import { defineStore } from 'pinia';
import { api, type BlueprintMeta } from '../api/client.js';

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
      const all = await api.meta();
      this.map = new Map(all.map((bp) => [bp.handle, bp]));
      this.hydrated = true;
    },
    get(handle: string): BlueprintMeta | undefined {
      return this.map.get(handle);
    },
  },
});
