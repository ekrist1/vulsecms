import { AdminApp, adminRouter } from '@vulse/admin';
import '@vulse/admin/styles';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

createApp(AdminApp).use(createPinia()).use(adminRouter).mount('#app');
