import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    ContentType: contentType,
    // Add cache control for images
    CacheControl: 'public, max-age=31536000', // 1 year
  });
  
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function checkFileExists(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
    });
    
    await s3Client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

export function getPublicUrl(key: string): string {
  const baseUrl = process.env.R2_PUBLIC_URL || `https://${process.env.R2_BUCKET}.${process.env.R2_DOMAIN}`;
  return `${baseUrl}/${key}`;
}

export function generateStorageKey(prefix: string, id: string, extension?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const suffix = extension ? `.${extension}` : '';
  return `${prefix}/${id}/${timestamp}-${random}${suffix}`;
}

// Validate content types
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png', 
  'image/webp'
] as const;

export function isValidImageType(contentType: string): contentType is typeof ALLOWED_IMAGE_TYPES[number] {
  return ALLOWED_IMAGE_TYPES.includes(contentType as any);
}

// File size limits (in bytes)
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB