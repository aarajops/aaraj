import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const localEnvironmentFile = fileURLToPath(
  new URL('../../../../../infrastructure/local/.env.local', import.meta.url),
);

let loaded = false;

export function loadLocalEnvironment(): void {
  if (loaded) return;
  loaded = true;

  if (
    process.env.NODE_ENV !== 'production' &&
    existsSync(localEnvironmentFile)
  ) {
    process.loadEnvFile(localEnvironmentFile);
  }
}
