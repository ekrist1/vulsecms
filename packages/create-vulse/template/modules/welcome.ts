// Example module: counts how many users have signed up since boot and
// exposes the number via /api/welcome/count. Delete this file or replace
// it with your own modules.
import type { VulseModule } from '@vulse/core';

let signups = 0;

export const welcome: VulseModule = {
  name: 'welcome',
  listeners(bus) {
    bus.on('user.registered', () => {
      signups++;
    });
  },
  routes(router) {
    router.get('/api/welcome/count', () => ({ signups }));
  },
};
