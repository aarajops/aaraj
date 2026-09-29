import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { AppService } from './app.service.js';
import { CONTRACT_VERSION, type HealthCheckResponse } from '@aaraj/contracts';
import { DatabaseService } from './platform/database/database.service.js';

@Controller()
@AllowAnonymous()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly databaseService: DatabaseService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): HealthCheckResponse {
    return {
      status: 'ok',
      service: '@aaraj/api',
      timestamp: new Date().toISOString(),
      version: CONTRACT_VERSION,
    };
  }

  @Get('health/ready')
  async getReadiness(): Promise<{ status: 'ok'; database: 'ok' }> {
    await this.databaseService.checkConnection();
    return { status: 'ok', database: 'ok' };
  }
}
