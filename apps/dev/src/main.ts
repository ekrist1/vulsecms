import { AdminApp, adminRouter } from '@vulse/admin';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import '@vulse/admin/styles';

createApp(AdminApp).use(createPinia()).use(adminRouter).mount('#app');
