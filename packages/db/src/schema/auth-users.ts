import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `auth.users` lives outside the public schema. Historically owned by Supabase
 * GoTrue; in the lean stack we manage it ourselves — a single-user table with
 * id, email, password_hash, created_at.
 *
 * Every public.* table that FKs into here uses the raw `uuid` type with the
 * constraint declared in the SQL migrations (Drizzle can't see cross-schema
 * FK targets when those tables live in different files).
 */
const authSchema = pgSchema('auth');

export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AuthUser = typeof authUsers.$inferSelect;
