import { Module } from '@nestjs/common';
import { AuthModule as BetterAuthNestModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth.js';

@Module({
  imports: [
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
