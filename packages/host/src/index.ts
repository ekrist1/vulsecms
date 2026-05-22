// Composable helpers for assembling a Vulse application.
//
// Users compose these in their own server entry. The recommended layout
// for a hand-written entry is ~50 lines, see docs/upgrading.md for the
// reference implementation.

export { prepareDatabase, type DatabaseConfig, type PreparedDatabase } from './database.js';
export { resolveSecrets, type ResolveSecretsOptions, type ResolvedSecrets } from './secrets.js';
export { createDefaultMailer, type DefaultMailerOptions } from './mailer.js';
export { createDefaultAuth, type DefaultAuthOptions } from './auth.js';
export {
  resolveStaticAsset,
  type ResolveStaticOptions,
  type StaticAsset,
} from './static.js';
export {
  createNodeServer,
  type CreateNodeServerOptions,
  type StaticRoot,
  type RequestListener,
} from './node-server.js';
export { buildHandlers, type BuildHandlersOptions, type BuiltHandlers } from './handlers.js';
