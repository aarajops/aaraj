import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { CONTRACT_VERSION, type HealthCheckResponse } from '@aaraj/contracts';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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
}
