import { router, protectedProcedure, TRPCError } from '@gigz/trpc';
import { db, attendances, attendancePhotos, users } from '@gigz/db';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { z } from 'zod';
import { canViewAttendance } from '../lib/privacy';
import { getConcertById, getConcertsByIds, incrementConcertAttendance, decrementConcertAttendance } from '../lib/clickhouse';
import { getPresignedUploadUrl, generateStorageKey, getPublicUrl, isValidImageType } from '../lib/storage';
import { queueNotification } from '../lib/notifications';

// Attendance schema for responses
const AttendanceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  concertId: z.string(),
  concertDate: z.date(),
  artistName: z.string(),
  venueName: z.string(),
  rating: z.number().nullable(),
  notes: z.string().nullable(),
  isPrivate: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const AttendancePhotoSchema = z.object({
  id: z.string(),
  attendanceId: z.string(),
  storageKey: z.string(),
  publicUrl: z.string().nullable(),
  caption: z.string().nullable(),
  status: z.enum(['pending', 'uploaded', 'failed']),
  createdAt: z.date(),
});

const AttendanceWithPhotosSchema = AttendanceSchema.extend({
  photos: z.array(AttendancePhotoSchema),
  concert: z.object({
    id: z.string(),
    artistName: z.string(),
    venueName: z.string(),
    city: z.string(),
    country: z.string(),
    date: z.string(),
    attendanceCount: z.number(),
  }).nullable(),
});

export const attendanceRouter = router({
  // List user's attendance
  list: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/attendance', protect: true, tags: ['Attendance'] } })
    .input(z.object({
      userId: z.string().uuid().optional(), // defaults to current user
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
      year: z.number().optional(),
    }))
    .output(z.object({
      items: z.array(AttendanceWithPhotosSchema),
      nextCursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const targetUserId = input.userId || ctx.user.id;
      
      // Check permissions if viewing another user
      if (targetUserId !== ctx.user.id) {
        const canView = await canViewAttendance(ctx.user.id, targetUserId);
        if (!canView) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot view this user\'s attendance' });
        }
      }
      
      // Build where conditions
      const conditions = [eq(attendances.userId, targetUserId)];
      
      if (input.year) {
        conditions.push(
          sql`EXTRACT(YEAR FROM ${attendances.concertDate}) = ${input.year}`
        );
      }
      
      if (input.cursor) {
        conditions.push(
          sql`${attendances.id} < ${input.cursor}`
        );
      }
      
      // Fetch attendance records
      const records = await db.query.attendances.findMany({
        where: and(...conditions),
        limit: input.limit + 1, // Get one extra to check if there's more
        orderBy: [desc(attendances.concertDate), desc(attendances.createdAt)],
        with: { photos: true },
      });
      
      // Check if there are more records
      const hasMore = records.length > input.limit;
      const items = hasMore ? records.slice(0, -1) : records;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;
      
      // Fetch concert details from ClickHouse
      const concertIds = items.map(r => r.concertId);
      const concerts = await getConcertsByIds(concertIds);
      const concertMap = new Map(concerts.map(c => [c.id, c]));
      
      // Merge data
      const attendanceWithConcerts = items.map(record => ({
        ...record,
        concert: concertMap.get(record.concertId) || null,
        photos: record.photos.map(photo => ({
          ...photo,
          publicUrl: photo.status === 'uploaded' ? getPublicUrl(photo.storageKey) : null,
        })),
      }));
      
      return {
        items: attendanceWithConcerts,
        nextCursor,
      };
    }),

  // Add attendance
  create: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/attendance', protect: true, tags: ['Attendance'] } })
    .input(z.object({
      concertId: z.string().uuid(),
      rating: z.number().min(1).max(5).optional(),
      notes: z.string().max(2000).optional(),
      isPrivate: z.boolean().default(false),
    }))
    .output(AttendanceSchema)
    .mutation(async ({ input, ctx }) => {
      // Verify concert exists in ClickHouse
      const concert = await getConcertById(input.concertId);
      if (!concert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Concert not found' });
      }
      
      // Check for duplicate attendance
      const existing = await db.query.attendances.findFirst({
        where: and(
          eq(attendances.userId, ctx.user.id),
          eq(attendances.concertId, input.concertId)
        ),
      });
      
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Already marked as attended' });
      }
      
      // Create attendance record
      const [attendance] = await db.insert(attendances).values({
        userId: ctx.user.id,
        concertId: input.concertId,
        concertDate: new Date(concert.date),
        artistName: concert.artistName,
        venueName: concert.venueName,
        rating: input.rating,
        notes: input.notes,
        isPrivate: input.isPrivate,
      }).returning();
      
      // Update user's total shows count
      await db.update(users)
        .set({ 
          totalShowsCount: sql`COALESCE(${users.totalShowsCount}, 0) + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id));
      
      // Update concert attendance count in ClickHouse
      await incrementConcertAttendance(input.concertId);
      
      // Queue notification for friends
      if (!input.isPrivate) {
        await queueNotification({
          type: 'new_attendance',
          userId: ctx.user.id,
          data: { 
            attendanceId: attendance.id,
            concertId: input.concertId,
            artistName: concert.artistName,
            venueName: concert.venueName,
          },
        });
      }
      
      return attendance;
    }),

  // Update attendance
  update: protectedProcedure
    .meta({ openapi: { method: 'PATCH', path: '/attendance/{id}', protect: true, tags: ['Attendance'] } })
    .input(z.object({
      id: z.string().uuid(),
      rating: z.number().min(1).max(5).optional(),
      notes: z.string().max(2000).optional(),
      isPrivate: z.boolean().optional(),
    }))
    .output(AttendanceSchema)
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;
      
      // Verify ownership and update
      const [updated] = await db.update(attendances)
        .set({ 
          ...updates, 
          updatedAt: new Date() 
        })
        .where(and(
          eq(attendances.id, id),
          eq(attendances.userId, ctx.user.id)
        ))
        .returning();
      
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attendance record not found' });
      }
      
      return updated;
    }),

  // Delete attendance
  delete: protectedProcedure
    .meta({ openapi: { method: 'DELETE', path: '/attendance/{id}', protect: true, tags: ['Attendance'] } })
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [deleted] = await db.delete(attendances)
        .where(and(
          eq(attendances.id, input.id),
          eq(attendances.userId, ctx.user.id)
        ))
        .returning();
      
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attendance record not found' });
      }
      
      // Update user's total shows count
      await db.update(users)
        .set({ 
          totalShowsCount: sql`GREATEST(COALESCE(${users.totalShowsCount}, 0) - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id));
      
      // Decrement concert attendance in ClickHouse
      await decrementConcertAttendance(deleted.concertId);
      
      return { success: true };
    }),

  // Get photo upload URL
  getPhotoUploadUrl: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/attendance/{id}/photo-upload-url', protect: true, tags: ['Attendance'] } })
    .input(z.object({
      attendanceId: z.string().uuid(),
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      caption: z.string().max(500).optional(),
    }))
    .output(z.object({
      uploadUrl: z.string(),
      photoId: z.string(),
      publicUrl: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!isValidImageType(input.contentType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid content type' });
      }
      
      // Verify attendance ownership
      const attendance = await db.query.attendances.findFirst({
        where: and(
          eq(attendances.id, input.attendanceId),
          eq(attendances.userId, ctx.user.id)
        ),
      });
      
      if (!attendance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Attendance record not found' });
      }
      
      // Check photo limit (max 10 per attendance)
      const photoCount = await db.select({ count: count() })
        .from(attendancePhotos)
        .where(eq(attendancePhotos.attendanceId, input.attendanceId));
      
      if (photoCount[0].count >= 10) {
        throw new TRPCError({ 
          code: 'BAD_REQUEST', 
          message: 'Maximum 10 photos allowed per concert' 
        });
      }
      
      // Generate storage key
      const extension = input.contentType.split('/')[1];
      const storageKey = generateStorageKey('attendance', input.attendanceId, extension);
      
      // Create photo record
      const [photo] = await db.insert(attendancePhotos).values({
        attendanceId: input.attendanceId,
        storageKey,
        contentType: input.contentType,
        caption: input.caption,
        status: 'pending',
      }).returning();
      
      // Get presigned upload URL
      const uploadUrl = await getPresignedUploadUrl(storageKey, input.contentType);
      const publicUrl = getPublicUrl(storageKey);
      
      return { 
        uploadUrl, 
        photoId: photo.id,
        publicUrl,
      };
    }),

  // Confirm photo upload
  confirmPhotoUpload: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/attendance/photos/{photoId}/confirm', protect: true, tags: ['Attendance'] } })
    .input(z.object({ photoId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Verify ownership through attendance
      const photo = await db.query.attendancePhotos.findFirst({
        where: eq(attendancePhotos.id, input.photoId),
        with: {
          attendance: true,
        },
      });
      
      if (!photo || photo.attendance?.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Photo not found' });
      }
      
      // Update photo status
      await db.update(attendancePhotos)
        .set({ 
          status: 'uploaded',
          updatedAt: new Date(),
        })
        .where(eq(attendancePhotos.id, input.photoId));
      
      return { success: true, publicUrl: getPublicUrl(photo.storageKey) };
    }),

  // Delete photo
  deletePhoto: protectedProcedure
    .meta({ openapi: { method: 'DELETE', path: '/attendance/photos/{photoId}', protect: true, tags: ['Attendance'] } })
    .input(z.object({ photoId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Verify ownership through attendance
      const photo = await db.query.attendancePhotos.findFirst({
        where: eq(attendancePhotos.id, input.photoId),
        with: {
          attendance: true,
        },
      });
      
      if (!photo || photo.attendance?.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Photo not found' });
      }
      
      // Delete photo record
      await db.delete(attendancePhotos)
        .where(eq(attendancePhotos.id, input.photoId));
      
      // Note: In a production system, you'd also want to delete the actual file from R2
      // This could be done via a background job or immediately here
      
      return { success: true };
    }),
});