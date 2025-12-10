import { db, users } from '@gigz/db';
import { eq } from 'drizzle-orm';

function generateRandomUsername(): string {
  const adjectives = ['cool', 'happy', 'bright', 'swift', 'calm', 'bold', 'wise', 'kind'];
  const nouns = ['user', 'fan', 'music', 'beat', 'sound', 'vibe', 'tune', 'note'];
  
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 9999);
  
  return `${adjective}${noun}${number}`;
}

function sanitizeUsername(input: string): string {
  // Extract name from email if it's an email
  if (input.includes('@')) {
    input = input.split('@')[0];
  }
  
  // Remove spaces and special characters, keep only alphanumeric
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20); // Limit length
}

export async function generateUsername(nameOrEmail?: string): Promise<string> {
  let baseUsername: string;
  
  if (nameOrEmail) {
    baseUsername = sanitizeUsername(nameOrEmail);
    // If sanitized username is too short, generate random
    if (baseUsername.length < 3) {
      baseUsername = generateRandomUsername();
    }
  } else {
    baseUsername = generateRandomUsername();
  }
  
  // Check if username exists and find available variant
  let username = baseUsername;
  let counter = 1;
  
  while (await usernameExists(username)) {
    username = `${baseUsername}${counter}`;
    counter++;
    
    // Prevent infinite loop
    if (counter > 9999) {
      username = generateRandomUsername();
      counter = 1;
      baseUsername = username;
    }
  }
  
  return username;
}

async function usernameExists(username: string): Promise<boolean> {
  const existingUser = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  
  return !!existingUser;
}