import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { RedisModule } from './platform/redis/redis.module.js';

@Module({
  imports: [DatabaseModule, RedisModule, AuthModule],
  controllers: [AppController],
})
export class AppModule {}
