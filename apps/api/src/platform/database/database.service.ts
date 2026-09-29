import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  closePostgresPool,
  getDrizzleDatabase,
  getPostgresPool,
} from './database-client.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  get db(): ReturnType<typeof getDrizzleDatabase> {
    return getDrizzleDatabase();
  }

  async checkConnection(): Promise<void> {
    await getPostgresPool().query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await closePostgresPool();
  }
}
