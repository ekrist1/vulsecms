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

export type Action = 'read' | 'create' | 'update' | 'delete';

export type EffectivePerms = Map<string, Set<Action>>;

export interface AuthVars {
  user: AuthUser | null;
  session: AuthSession | null;
  perms?: EffectivePerms;
}
