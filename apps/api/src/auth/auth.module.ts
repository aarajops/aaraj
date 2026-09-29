import { Module } from '@nestjs/common';
import { AuthModule as BetterAuthNestModule } from '@thallesp/nestjs-better-auth';
import { RedisModule } from '../platform/redis/redis.module.js';
import { auth } from './auth.js';

@Module({
  imports: [
    RedisModule,
    BetterAuthNestModule.forRoot({
      auth,
      disableTrustedOriginsCors: true,
      bodyParser: {
        json: { limit: '1mb' },
        urlencoded: { enabled: true, extended: true, limit: '1mb' },
      },
    }),
  ],
})
export class AuthModule {}
