# Nest Commander CLI Applications

> **Domain**: Standalone CLI Tools, Script Automation & Dependency Injection  
> **Source Reference**: [NestJS Commander Recipe](https://docs.nestjs.com/recipes/nest-commander)  
> **Package**: `nest-commander` | `nest-commander-testing`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

The [`nest-commander`](https://nest-commander.jaymcdoniel.dev) package enables authoring robust command-line applications using the familiar NestJS architecture: decorators (`@Command()`, `@Option()`), dependency injection, configuration services, and module boundaries.

---

## 1. Installation

Install `nest-commander`:

```bash
pnpm add nest-commander
pnpm add -D nest-commander-testing
```

---

## 2. Authoring a CLI Command

Every command extends the `CommandRunner` abstract class and implements the `run()` lifecycle method:

```typescript
// apps/api/src/cli/commands/seed.command.ts
import { Command, CommandRunner, Option } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { UsersRepository } from '../../users/users.repository.js';

interface SeedCommandOptions {
  count?: number;
  dryRun?: boolean;
}

@Command({
  name: 'seed',
  description: 'Seeds the database with mock tenant and user accounts',
})
export class SeedCommand extends CommandRunner {
  private readonly logger = new Logger(SeedCommand.name);

  constructor(private readonly usersRepository: UsersRepository) {
    super();
  }

  async run(passedParams: string[], options?: SeedCommandOptions): Promise<void> {
    const count = options?.count ?? 10;
    const isDryRun = options?.dryRun ?? false;

    this.logger.log(`Executing seed operation: count=${count}, dryRun=${isDryRun}`);

    if (!isDryRun) {
      await this.usersRepository.seedMockUsers(count);
      this.logger.log('Database seeded successfully');
    }
  }

  @Option({
    flags: '-c, --count [number]',
    description: 'Number of entity records to generate',
  })
  parseCount(val: string): number {
    return Number.parseInt(val, 10);
  }

  @Option({
    flags: '-d, --dry-run [boolean]',
    description: 'Simulates generation without persisting records',
  })
  parseDryRun(val: string): boolean {
    return val === 'true' || val === '';
  }
}
```

---

## 3. Registering the Command Module & Bootstrapping

Register the command class as a provider in your module:

```typescript
// apps/api/src/cli/cli.module.ts
import { Module } from '@nestjs/common';
import { SeedCommand } from './commands/seed.command.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [UsersModule],
  providers: [SeedCommand],
})
export class CliModule {}
```

Create a CLI entry point `src/cli.ts` using `CommandFactory`:

```typescript
// apps/api/src/cli.ts
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module.js';

async function bootstrap() {
  await CommandFactory.run(CliModule, ['warn', 'error']);
}

await bootstrap();
```

> [!NOTE]
> `CommandFactory.run()` automatically manages the IoC container lifecycle, executes your command, gracefully triggers `app.close()`, and exits the process with the proper system status code.

---

## 4. Execution via Shell

```bash
# Display help and options
node dist/apps/api/src/cli.js seed --help

# Execute seed command with custom flags
node dist/apps/api/src/cli.js seed --count 50 --dry-run
```

---

## 5. Automated Unit & Integration Testing (`CommandTestFactory`)

```typescript
// apps/api/src/cli/commands/seed.command.spec.ts
import { CommandTestFactory } from 'nest-commander-testing';
import { describe, it, expect, vi } from 'vitest';
import { CliModule } from '../cli.module.js';
import { UsersRepository } from '../../users/users.repository.js';

describe('SeedCommand', () => {
  it('invokes seed method with parsed count', async () => {
    const mockSeed = vi.fn().mockResolvedValue(undefined);

    const commandInstance = await CommandTestFactory.createTestingCommand({
      imports: [CliModule],
    })
      .overrideProvider(UsersRepository)
      .useValue({ seedMockUsers: mockSeed })
      .compile();

    await CommandTestFactory.run(commandInstance, ['seed', '-c', '25']);

    expect(mockSeed).toHaveBeenCalledWith(25);
  });
});
```
