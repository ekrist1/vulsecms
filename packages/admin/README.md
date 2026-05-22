# @vulse/admin

Vue 3 admin SPA for [Vulse](https://github.com/ekrist1/vulsecms). Consumed
as source — your app's Vite config compiles it together with your own code.

```sh
pnpm add @vulse/admin
```

```ts
// src/main.ts
import { AdminApp, adminRouter } from '@vulse/admin';
import '@vulse/admin/styles';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

createApp(AdminApp).use(createPinia()).use(adminRouter).mount('#app');
```
