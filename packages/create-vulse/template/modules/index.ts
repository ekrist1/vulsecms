import type { VulseModule } from '@vulse/core';
import { welcome } from './welcome.js';

// Modules are the extension point for adding migrations, routes, and
// event listeners without touching package source. Add your own modules
// here and they will be wired up at boot.
export const modules: VulseModule[] = [welcome];
