import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified').notNull().default(0),
  name: text('name'),
  image: text('image'),
  role: text('role', { enum: ['editor', 'external_user'] }).notNull(),
  isSuper: integer('is_super').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: text('access_token_expires_at'),
  refreshTokenExpiresAt: text('refresh_token_expires_at'),
  scope: text('scope'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  label: text('label').notNull(),
  createdAt: text('created_at').notNull(),
});

export const userGroups = sqliteTable(
  'user_groups',
  {
    userId: text('user_id').notNull(),
    groupId: text('group_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.groupId] }) }),
);

export const groupPermissions = sqliteTable(
  'group_permissions',
  {
    groupId: text('group_id').notNull(),
    collectionHandle: text('collection_handle').notNull(),
    canRead: integer('can_read').notNull().default(0),
    canCreate: integer('can_create').notNull().default(0),
    canUpdate: integer('can_update').notNull().default(0),
    canDelete: integer('can_delete').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.groupId, t.collectionHandle] }) }),
);

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  groups,
  userGroups,
  groupPermissions,
};
