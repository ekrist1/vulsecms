#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve(process.env.VULSE_IMAGE_CACHE_DIR ?? '.vulse/cache/img');
await rm(dir, { recursive: true, force: true });
console.log(`[image] cleared ${dir}`);
