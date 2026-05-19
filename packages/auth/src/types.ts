export type Role = 'editor' | 'external_user';

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  role: Role;
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
  token: string;
}

export type Action = 'read' | 'create' | 'update' | 'delete' | 'publish';

export type EffectivePerms = Map<string, Set<Action>>;

// Backwards-compatibility alias — the live source of truth is `H3EventContext`
// (augmented below). Kept so downstream code that imported the shape still
// compiles during the Hono → h3 transition.
export interface AuthVars {
  user: AuthUser | null;
  session: AuthSession | null;
  perms?: EffectivePerms;
}

declare module 'h3' {
  interface H3EventContext {
    user: AuthUser | null;
    session: AuthSession | null;
    perms?: EffectivePerms;
  }
}
