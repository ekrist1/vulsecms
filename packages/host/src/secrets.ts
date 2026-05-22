import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export interface ResolveSecretsOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  // Absolute path used to compute the default image-cache directory.
  appRoot: string;
}

export interface ResolvedSecrets {
  previewSecret: string;
  imageSecret: string;
  imageCacheDir: string;
  // True when previewSecret was generated this boot — signed preview links
  // will not survive a restart.
  previewSecretEphemeral: boolean;
}

export function resolveSecrets(opts: ResolveSecretsOptions): ResolvedSecrets {
  const env = opts.env ?? process.env;
  const sessionSecret = env.VULSE_SESSION_SECRET;
  const explicitPreview = env.VULSE_PREVIEW_SECRET ?? sessionSecret;

  let previewSecret: string;
  let previewSecretEphemeral = false;
  if (explicitPreview) {
    previewSecret = explicitPreview;
  } else {
    previewSecret = randomBytes(32).toString('hex');
    previewSecretEphemeral = true;
  }

  const imageSecret = env.VULSE_IMAGE_SECRET ?? sessionSecret ?? previewSecret;
  const imageCacheDir = env.VULSE_IMAGE_CACHE_DIR
    ? resolve(env.VULSE_IMAGE_CACHE_DIR)
    : resolve(opts.appRoot, '.vulse', 'cache', 'img');

  return { previewSecret, imageSecret, imageCacheDir, previewSecretEphemeral };
}
