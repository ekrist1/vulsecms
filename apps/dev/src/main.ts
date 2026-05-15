import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { AdminApp, adminRouter } from '@vulse/admin';
import '@vulse/admin/styles';

createApp(AdminApp).use(createPinia()).use(adminRouter).mount('#app');
