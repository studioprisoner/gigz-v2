#!/usr/bin/env bun

import { db, users } from '../src';
import { eq } from 'drizzle-orm';
import { hash } from 'argon2';

async function seedAdmin() {
  console.log('🌱 Seeding admin user...');

  const email = 'support@gig.app';
  const password = 'GigzAdmin2024!';
  const displayName = 'Gigz Admin';

  // Check if admin already exists
  const existingAdmin = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingAdmin) {
    console.log('✅ Admin user already exists');
    return;
  }

  // Create admin user
  const passwordHash = await hash(password);

  const [adminUser] = await db.insert(users).values({
    email,
    username: 'gigz-admin',
    displayName,
    passwordHash,
    isAdmin: true,
  }).returning();

  console.log('✅ Admin user created successfully');
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log(`User ID: ${adminUser.id}`);

  process.exit(0);
}

seedAdmin().catch((error) => {
  console.error('❌ Failed to seed admin user:', error);
  process.exit(1);
});