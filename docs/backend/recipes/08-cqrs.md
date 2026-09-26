# CQRS Architecture (Command Query Responsibility Segregation)

> **Domain**: Event-Driven Systems, Read/Write Segregation & Saga Orchestration  
> **Source Reference**: [NestJS CQRS Recipe](https://docs.nestjs.com/recipes/cqrs)  
> **Package**: `@nestjs/cqrs`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

In standard CRUD applications, controllers delegate directly to services, which execute business logic and mutate relational entities. For high-scale, domain-driven systems, the **CQRS** (Command and Query Responsibility Segregation) pattern segregates read models from write models. This separation allows writes to focus strictly on transactional domain integrity while read models scale independently using read-optimized views or denormalized caches.

---

## 1. Installation & Module Initialization

Install the official NestJS CQRS module:

```bash
pnpm add @nestjs/cqrs
```

Register `CqrsModule.forRoot()` in your root module:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

@Module({
  imports: [
    CqrsModule.forRoot({
      rethrowUnhandled: false, // Routes unhandled exceptions to UnhandledExceptionBus
    }),
  ],
})
export class AppModule {}
```

---

## 2. Commands & `CommandBus` (Mutations)

Commands represent task-based intents to modify application state (e.g. `RegisterUserCommand`, `CancelOrderCommand`).

### Step 1: Define the Command Contract

Extend the `Command<TResult>` utility class to define the strongly typed return shape:

```typescript
// apps/api/src/heroes/commands/kill-dragon.command.ts
import { Command } from '@nestjs/cqrs';

export interface KillDragonResult {
  actionId: string;
}

export class KillDragonCommand extends Command<KillDragonResult> {
  constructor(
    public readonly heroId: string,
    public readonly dragonId: string,
  ) {
    super();
  }
}
```

### Step 2: Implement the Command Handler

Annotate the handler with `@CommandHandler()` and implement `ICommandHandler`:

```typescript
// apps/api/src/heroes/commands/kill-dragon.handler.ts
import { CommandHandler, EventPublisher, type ICommandHandler } from '@nestjs/cqrs';
import { KillDragonCommand, type KillDragonResult } from './kill-dragon.command.js';
import { HeroesRepository } from '../heroes.repository.js';

@CommandHandler(KillDragonCommand)
export class KillDragonHandler implements ICommandHandler<KillDragonCommand, KillDragonResult> {
  constructor(
    private readonly repository: HeroesRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: KillDragonCommand): Promise<KillDragonResult> {
    const { heroId, dragonId } = command;

    // Merge EventPublisher into domain aggregate root
    const hero = this.publisher.mergeObjectContext(
      await this.repository.findById(heroId),
    );

    hero.killEnemy(dragonId); // Domain logic applies HeroKilledDragonEvent
    hero.commit();            // Publishes all uncommitted events to EventBus

    await this.repository.save(hero);

    return { actionId: crypto.randomUUID() };
  }
}
```

### Step 3: Dispatch via `CommandBus`

```typescript
// apps/api/src/heroes/heroes.controller.ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { KillDragonCommand } from './commands/kill-dragon.command.js';

@Controller('heroes')
export class HeroesController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post(':id/kill')
  async killDragon(@Param('id') heroId: string, @Body('dragonId') dragonId: string) {
    // Inferred return type is Promise<KillDragonResult>
    return this.commandBus.execute(new KillDragonCommand(heroId, dragonId));
  }
}
```

---

## 3. Queries & `QueryBus` (Reads)

Queries represent data-centric intents to retrieve data without altering state:

```typescript
// apps/api/src/heroes/queries/get-hero.query.ts
import { Query } from '@nestjs/cqrs';
import type { HeroDto } from '../dto/hero.dto.js';

export class GetHeroQuery extends Query<HeroDto> {
  constructor(public readonly heroId: string) {
    super();
  }
}
```

```typescript
// apps/api/src/heroes/queries/get-hero.handler.ts
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetHeroQuery } from './get-hero.query.js';
import { HeroesRepository } from '../heroes.repository.js';
import type { HeroDto } from '../dto/hero.dto.js';

@QueryHandler(GetHeroQuery)
export class GetHeroHandler implements IQueryHandler<GetHeroQuery, HeroDto> {
  constructor(private readonly repository: HeroesRepository) {}

  async execute(query: GetHeroQuery): Promise<HeroDto> {
    return this.repository.findReadModelById(query.heroId);
  }
}
```

Dispatching queries:

```typescript
const hero = await this.queryBus.execute(new GetHeroQuery('hero-123'));
```

---

## 4. Aggregate Roots & Event Publishing

Aggregate roots encapsulate domain entities and record business state changes by applying domain events:

### Approach 1: Class Inheritance (`AggregateRoot`)

```typescript
// apps/api/src/heroes/models/hero.model.ts
import { AggregateRoot } from '@nestjs/cqrs';
import { HeroKilledDragonEvent } from '../events/hero-killed-dragon.event.js';

export class Hero extends AggregateRoot {
  constructor(private readonly id: string) {
    super();
  }

  killEnemy(enemyId: string) {
    // Stage event in memory
    this.apply(new HeroKilledDragonEvent(this.id, enemyId));
  }
}
```

### Approach 2: Mixin (`WithAggregateRoot`) for Existing Inheritance Trees

If domain models already extend an ORM base class (e.g. `BaseEntity`), apply the mixin:

```typescript
import { WithAggregateRoot } from '@nestjs/cqrs';

abstract class Character {
  constructor(protected readonly id: string) {}
}

export class Hero extends WithAggregateRoot(Character) {
  killEnemy(enemyId: string) {
    this.apply(new HeroKilledDragonEvent(this.id, enemyId));
  }
}
```

### Event Handlers

Event handlers respond to committed domain events (e.g. updating a materialized read view or sending notifications):

```typescript
// apps/api/src/heroes/events/hero-killed-dragon.handler.ts
import { EventsHandler, type IEventHandler } from '@nestjs/cqrs';
import { HeroKilledDragonEvent } from './hero-killed-dragon.event.js';

@EventsHandler(HeroKilledDragonEvent)
export class HeroKilledDragonHandler implements IEventHandler<HeroKilledDragonEvent> {
  async handle(event: HeroKilledDragonEvent) {
    console.log(`Hero ${event.heroId} vanquished dragon ${event.dragonId}`);
  }
}
```

---

## 5. Sagas & Reactive Workflow Orchestration

A **Saga** is a long-running workflow that listens to one or more domain events, processes stream transformations via RxJS, and returns an `Observable<ICommand>` that dispatches follow-up commands:

```typescript
// apps/api/src/heroes/sagas/heroes.sagas.ts
import { Injectable } from '@nestjs/common';
import { type ICommand, ofType, Saga } from '@nestjs/cqrs';
import { map, type Observable } from 'rxjs';
import { HeroKilledDragonEvent } from '../events/hero-killed-dragon.event.js';
import { AwardBountyCommand } from '../commands/award-bounty.command.js';

@Injectable()
export class HeroesGameSagas {
  @Saga()
  dragonKilled = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(HeroKilledDragonEvent),
      map((event) => new AwardBountyCommand(event.heroId, 500)),
    );
  };
}
```

---

## 6. Unhandled Exception Bus

Because event handlers execute asynchronously outside the HTTP request/response pipeline, unhandled errors bypass standard exception filters. The `UnhandledExceptionBus` provides an observable stream for centralized dead-letter processing:

```typescript
// apps/api/src/common/services/unhandled-cqrs-exceptions.service.ts
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { UnhandledExceptionBus } from '@nestjs/cqrs';
import { Subject, takeUntil } from 'rxjs';

@Injectable()
export class UnhandledCqrsExceptionsService implements OnModuleDestroy {
  private readonly destroy$ = new Subject<void>();

  constructor(private readonly unhandledExceptionsBus: UnhandledExceptionBus) {
    this.unhandledExceptionsBus
      .pipe(takeUntil(this.destroy$))
      .subscribe((exceptionInfo) => {
        console.error('Unhandled CQRS failure detected:', {
          cause: exceptionInfo.cause,
          error: exceptionInfo.exception,
        });
      });
  }

  onModuleDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```
