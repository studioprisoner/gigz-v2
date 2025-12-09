import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const lastfmConnections = pgTable('lastfm_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),

  lastfmUsername: varchar('lastfm_username', { length: 100 }).notNull(),
  sessionKey: varchar('session_key', { length: 255 }),

  topArtists: text('top_artists'), // JSON
  topArtistsFetchedAt: timestamp('top_artists_fetched_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});