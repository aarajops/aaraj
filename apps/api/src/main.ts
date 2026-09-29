import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './configure-app.js';
import { loadLocalEnvironment } from './platform/config/local-environment.js';

loadLocalEnvironment();
const { AppModule } = await import('./app.module.js');

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: new ConsoleLogger({
      json: isProduction,
      logLevels: isProduction
        ? ['log', 'warn', 'error', 'fatal']
        : ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'],
    }),
  });
  configureApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}
await bootstrap();
