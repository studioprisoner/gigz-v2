import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

// Device platform enum
export enum DevicePlatform {
  IOS = 'ios',
  ANDROID = 'android',
}

// Device registration schema
export const DeviceRegistrationSchema = z.object({
  userId: z.string().uuid(),
  token: z.string().min(1),
  platform: z.nativeEnum(DevicePlatform),
  deviceId: z.string().optional(),
  deviceName: z.string().optional(),
  deviceModel: z.string().optional(),
  appVersion: z.string().optional(),
  osVersion: z.string().optional(),
});

export type DeviceRegistration = z.infer<typeof DeviceRegistrationSchema>;

// Device record interface
export interface DeviceRecord {
  id: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  deviceId?: string;
  deviceName?: string;
  deviceModel?: string;
  appVersion?: string;
  osVersion?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsed: Date;
  failureCount: number;
  lastFailure?: Date;
}

// Device token validation result
export interface TokenValidationResult {
  isValid: boolean;
  reason?: 'invalid_format' | 'too_short' | 'too_long' | 'invalid_characters';
}

// Device statistics
export interface DeviceStats {
  totalDevices: number;
  activeDevices: number;
  inactiveDevices: number;
  devicesByPlatform: Record<DevicePlatform, number>;
  recentRegistrations: number;
  failedTokens: number;
}

// Device manager service
export class DeviceManager {
  private dbClient: any;
  private logger: any;

  constructor(dbClient: any, logger: any) {
    this.dbClient = dbClient;
    this.logger = logger;
  }

  // Register a new device token
  async registerDevice(registration: DeviceRegistration): Promise<DeviceRecord> {
    DeviceRegistrationSchema.parse(registration);

    this.logger.info('Registering device token', {
      userId: registration.userId,
      platform: registration.platform,
      deviceName: registration.deviceName,
    });

    try {
      // Validate token format
      const validation = this.validateToken(registration.token, registration.platform);
      if (!validation.isValid) {
        throw new Error(`Invalid token format: ${validation.reason}`);
      }

      // Check if device already exists
      const existingDevice = await this.findDeviceByToken(registration.token);

      if (existingDevice) {
        // Update existing device
        this.logger.info('Updating existing device token', {
          deviceId: existingDevice.id,
          userId: registration.userId,
        });

        return this.updateDevice(existingDevice.id, {
          userId: registration.userId,
          deviceName: registration.deviceName,
          deviceModel: registration.deviceModel,
          appVersion: registration.appVersion,
          osVersion: registration.osVersion,
          active: true,
          lastUsed: new Date(),
          failureCount: 0, // Reset failure count on re-registration
          lastFailure: undefined,
        });
      }

      // Create new device record
      const deviceRecord: DeviceRecord = {
        id: uuidv4(),
        userId: registration.userId,
        token: registration.token,
        platform: registration.platform,
        deviceId: registration.deviceId,
        deviceName: registration.deviceName,
        deviceModel: registration.deviceModel,
        appVersion: registration.appVersion,
        osVersion: registration.osVersion,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsed: new Date(),
        failureCount: 0,
      };

      await this.insertDevice(deviceRecord);

      this.logger.info('Device token registered successfully', {
        deviceId: deviceRecord.id,
        userId: registration.userId,
        platform: registration.platform,
      });

      return deviceRecord;

    } catch (error) {
      this.logger.error('Failed to register device token', {
        userId: registration.userId,
        platform: registration.platform,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Get devices for a user
  async getUserDevices(userId: string, platform?: DevicePlatform): Promise<DeviceRecord[]> {
    try {
      // TODO: Replace with actual database query
      // Example query:
      // const conditions = [eq(userDevices.userId, userId), eq(userDevices.active, true)];
      // if (platform) {
      //   conditions.push(eq(userDevices.platform, platform));
      // }
      //
      // const devices = await this.dbClient.query.userDevices.findMany({
      //   where: and(...conditions),
      //   orderBy: desc(userDevices.lastUsed)
      // });

      // Placeholder implementation
      const devices: DeviceRecord[] = [];

      this.logger.debug(`Retrieved ${devices.length} devices for user ${userId}`, {
        userId,
        platform,
      });

      return devices;

    } catch (error) {
      this.logger.error('Failed to retrieve user devices', {
        userId,
        platform,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  // Find device by token
  async findDeviceByToken(token: string): Promise<DeviceRecord | null> {
    try {
      // TODO: Replace with actual database query
      // const device = await this.dbClient.query.userDevices.findFirst({
      //   where: eq(userDevices.token, token)
      // });

      // Placeholder implementation
      const device: DeviceRecord | null = null;

      return device;

    } catch (error) {
      this.logger.error('Failed to find device by token', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  // Update device information
  async updateDevice(deviceId: string, updates: Partial<DeviceRecord>): Promise<DeviceRecord> {
    try {
      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      // TODO: Replace with actual database update
      // await this.dbClient.update(userDevices)
      //   .set(updateData)
      //   .where(eq(userDevices.id, deviceId));

      // const updatedDevice = await this.dbClient.query.userDevices.findFirst({
      //   where: eq(userDevices.id, deviceId)
      // });

      // Placeholder implementation
      const updatedDevice: DeviceRecord = {
        id: deviceId,
        userId: '',
        token: '',
        platform: DevicePlatform.IOS,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsed: new Date(),
        failureCount: 0,
        ...updates,
      };

      this.logger.debug('Device updated successfully', {
        deviceId,
        updates: Object.keys(updates),
      });

      return updatedDevice;

    } catch (error) {
      this.logger.error('Failed to update device', {
        deviceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Mark device as inactive
  async deactivateDevice(deviceId: string, reason?: string): Promise<void> {
    try {
      await this.updateDevice(deviceId, {
        active: false,
        lastFailure: new Date(),
      });

      this.logger.info('Device deactivated', {
        deviceId,
        reason,
      });

    } catch (error) {
      this.logger.error('Failed to deactivate device', {
        deviceId,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Mark multiple devices as inactive by token
  async deactivateDevicesByTokens(tokens: string[], reason?: string): Promise<number> {
    if (tokens.length === 0) {
      return 0;
    }

    try {
      // TODO: Replace with actual database update
      // const result = await this.dbClient.update(userDevices)
      //   .set({
      //     active: false,
      //     lastFailure: new Date(),
      //     updatedAt: new Date()
      //   })
      //   .where(inArray(userDevices.token, tokens));

      // Placeholder implementation
      const affectedRows = tokens.length;

      this.logger.info('Devices deactivated by tokens', {
        count: affectedRows,
        reason,
      });

      return affectedRows;

    } catch (error) {
      this.logger.error('Failed to deactivate devices by tokens', {
        tokenCount: tokens.length,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Increment failure count for a device
  async recordFailure(deviceId: string, error?: string): Promise<void> {
    try {
      // Get current device
      const device = await this.getDeviceById(deviceId);
      if (!device) {
        this.logger.warn('Device not found for failure recording', { deviceId });
        return;
      }

      const newFailureCount = device.failureCount + 1;
      const shouldDeactivate = newFailureCount >= 3; // Deactivate after 3 failures

      await this.updateDevice(deviceId, {
        failureCount: newFailureCount,
        lastFailure: new Date(),
        active: !shouldDeactivate,
      });

      if (shouldDeactivate) {
        this.logger.warn('Device deactivated due to repeated failures', {
          deviceId,
          failureCount: newFailureCount,
          error,
        });
      } else {
        this.logger.debug('Device failure recorded', {
          deviceId,
          failureCount: newFailureCount,
          error,
        });
      }

    } catch (error) {
      this.logger.error('Failed to record device failure', {
        deviceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Get device by ID
  async getDeviceById(deviceId: string): Promise<DeviceRecord | null> {
    try {
      // TODO: Replace with actual database query
      // const device = await this.dbClient.query.userDevices.findFirst({
      //   where: eq(userDevices.id, deviceId)
      // });

      // Placeholder implementation
      const device: DeviceRecord | null = null;

      return device;

    } catch (error) {
      this.logger.error('Failed to get device by ID', {
        deviceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  // Clean up old inactive devices
  async cleanupInactiveDevices(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // TODO: Replace with actual database deletion
      // const result = await this.dbClient.delete(userDevices)
      //   .where(
      //     and(
      //       eq(userDevices.active, false),
      //       lt(userDevices.lastUsed, cutoffDate)
      //     )
      //   );

      // Placeholder implementation
      const deletedCount = 0;

      this.logger.info('Cleanup completed for inactive devices', {
        deletedCount,
        olderThanDays,
      });

      return deletedCount;

    } catch (error) {
      this.logger.error('Failed to cleanup inactive devices', {
        olderThanDays,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Get device statistics
  async getDeviceStats(): Promise<DeviceStats> {
    try {
      // TODO: Replace with actual database queries
      // const stats = await this.dbClient.query.userDevices.findMany({
      //   columns: { platform: true, active: true, createdAt: true }
      // });

      // Placeholder implementation
      const stats: DeviceStats = {
        totalDevices: 0,
        activeDevices: 0,
        inactiveDevices: 0,
        devicesByPlatform: {
          [DevicePlatform.IOS]: 0,
          [DevicePlatform.ANDROID]: 0,
        },
        recentRegistrations: 0,
        failedTokens: 0,
      };

      this.logger.debug('Device statistics retrieved', stats);

      return stats;

    } catch (error) {
      this.logger.error('Failed to get device statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return empty stats on error
      return {
        totalDevices: 0,
        activeDevices: 0,
        inactiveDevices: 0,
        devicesByPlatform: {
          [DevicePlatform.IOS]: 0,
          [DevicePlatform.ANDROID]: 0,
        },
        recentRegistrations: 0,
        failedTokens: 0,
      };
    }
  }

  // Validate device token format
  private validateToken(token: string, platform: DevicePlatform): TokenValidationResult {
    // Basic validation
    if (!token || token.trim().length === 0) {
      return { isValid: false, reason: 'invalid_format' };
    }

    // Platform-specific validation
    switch (platform) {
      case DevicePlatform.IOS:
        return this.validateIOSToken(token);
      case DevicePlatform.ANDROID:
        return this.validateAndroidToken(token);
      default:
        return { isValid: false, reason: 'invalid_format' };
    }
  }

  // Validate iOS APNs token
  private validateIOSToken(token: string): TokenValidationResult {
    // iOS tokens should be 64 characters of hex
    if (token.length !== 64) {
      return { isValid: false, reason: token.length < 64 ? 'too_short' : 'too_long' };
    }

    // Check if it's valid hex
    const hexPattern = /^[0-9a-fA-F]+$/;
    if (!hexPattern.test(token)) {
      return { isValid: false, reason: 'invalid_characters' };
    }

    return { isValid: true };
  }

  // Validate Android FCM token
  private validateAndroidToken(token: string): TokenValidationResult {
    // Android FCM tokens are typically much longer and contain various characters
    if (token.length < 100) {
      return { isValid: false, reason: 'too_short' };
    }

    if (token.length > 200) {
      return { isValid: false, reason: 'too_long' };
    }

    // Basic format check - FCM tokens contain alphanumeric characters and some symbols
    const fcmPattern = /^[a-zA-Z0-9_:.-]+$/;
    if (!fcmPattern.test(token)) {
      return { isValid: false, reason: 'invalid_characters' };
    }

    return { isValid: true };
  }

  // Insert new device record (placeholder)
  private async insertDevice(device: DeviceRecord): Promise<void> {
    try {
      // TODO: Replace with actual database insert
      // await this.dbClient.insert(userDevices).values(device);

      this.logger.debug('Device record inserted', {
        deviceId: device.id,
        userId: device.userId,
        platform: device.platform,
      });

    } catch (error) {
      this.logger.error('Failed to insert device record', {
        deviceId: device.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}