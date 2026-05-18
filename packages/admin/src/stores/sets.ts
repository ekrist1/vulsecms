import { defineStore } from 'pinia';
import { api, type SetDTO } from '../api/client.js';

export const useSetsStore = defineStore('sets', {
  state: () => ({
    map: new Map<string, SetDTO>(),
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
      const all = await api.listSets();
      this.map = new Map(all.map((s) => [s.handle, s]));
    },
    get(handle: string): SetDTO | undefined {
      return this.map.get(handle);
    },
  },
});
