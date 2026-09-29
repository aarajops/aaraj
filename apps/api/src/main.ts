import { NestFactory } from '@nestjs/core';
import { configureApp } from './configure-app.js';
import { loadLocalEnvironment } from './platform/config/local-environment.js';

loadLocalEnvironment();
const { AppModule } = await import('./app.module.js');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}
await bootstrap();
