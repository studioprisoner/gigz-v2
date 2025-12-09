import { pgTable, uuid, varchar, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';
import { users } from './users';

export const attendances = pgTable('attendances', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Reference to ClickHouse concert ID (stored as string)
  concertId: varchar('concert_id', { length: 36 }).notNull(),

  // Personal data
  rating: integer('rating'),
  notes: text('notes'),
  attendedWith: varchar('attended_with', { length: 500 }),

  // Sharing
  sharedWithFriends: boolean('shared_with_friends').default(false),

  // Migration
  legacyId: uuid('legacy_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const attendancePhotos = pgTable('attendance_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  attendanceId: uuid('attendance_id').notNull().references(() => attendances.id, { onDelete: 'cascade' }),

  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  storageUrl: varchar('storage_url', { length: 500 }).notNull(),

  originalFilename: varchar('original_filename', { length: 255 }),
  contentType: varchar('content_type', { length: 50 }),
  fileSizeBytes: integer('file_size_bytes'),
  width: integer('width'),
  height: integer('height'),

  processingStatus: varchar('processing_status', { length: 20 }).default('pending'),
  thumbnailUrl: varchar('thumbnail_url', { length: 500 }),
  position: integer('position').default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});