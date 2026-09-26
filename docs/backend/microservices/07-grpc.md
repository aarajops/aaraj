# Microservices: gRPC Transporter

> **Source**: https://docs.nestjs.com/microservices/grpc  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `@grpc/grpc-js`, `@grpc/proto-loader`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[gRPC](https://grpc.io/) is an open-source, high-performance Remote Procedure Call (RPC) framework that runs over HTTP/2 with binary serialization via [Protocol Buffers (protobuf)](https://protobuf.dev/). It enables low-latency, strongly-typed polyglot communication with built-in streaming, authentication, and tracing capabilities.

---

## 1. Installation & Asset Distribution

Install the official Node.js gRPC driver and protobuf loader:

```bash
pnpm add @grpc/grpc-js @grpc/proto-loader
```

To ensure `.proto` files are automatically copied from `src/` to `dist/` during builds, update `nest-cli.json`:

```json
{
  "compilerOptions": {
    "assets": ["**/*.proto"],
    "watchAssets": true
  }
}
```

---

## 2. Server Configuration & Protobuf Contracts

### 2.1 Defining the Protocol Buffer (`hero.proto`)

```protobuf
// src/hero/hero.proto
syntax = "proto3";

package hero;

service HeroesService {
  rpc FindOne (HeroById) returns (Hero) {}
  rpc CreateHero (CreateHeroDto) returns (Hero) {}
}

message HeroById {
  int32 id = 1;
}

message CreateHeroDto {
  string name = 1;
  string power = 2;
}

message Hero {
  int32 id = 1;
  string name = 2;
  string power = 3;
}
```

### 2.2 Bootstrapping the gRPC Server

```typescript
// src/main.ts
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions, GrpcExceptionFilter } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'hero',
        protoPath: join(import.meta.dirname, 'hero/hero.proto'),
        url: '0.0.0.0:50051',
        loader: {
          keepCase: true, // Preserves snake_case field names in JSON
        },
      },
    },
  );

  // NestJS 12: Attach dedicated gRPC exception filter
  app.useGlobalFilters(new GrpcExceptionFilter());

  await app.listen();
}
void bootstrap();
```

---

## 3. Implementing gRPC Handlers (`@GrpcMethod`)

```typescript
// src/hero/hero.controller.ts
import { Controller } from '@nestjs/common';
import { GrpcMethod, GrpcAlreadyExistsException } from '@nestjs/microservices';
import { Metadata, ServerUnaryCall } from '@grpc/grpc-js';

interface HeroById {
  id: number;
}

interface Hero {
  id: number;
  name: string;
  power: string;
}

@Controller()
export class HeroController {
  private readonly heroes: Hero[] = [
    { id: 1, name: 'Superman', power: 'Flight' },
    { id: 2, name: 'Batman', power: 'Wealth' },
  ];

  @GrpcMethod('HeroesService', 'FindOne')
  findOne(data: HeroById, metadata: Metadata, call: ServerUnaryCall<any, any>): Hero | undefined {
    // Read incoming client metadata headers
    const clientTrace = metadata.get('x-trace-id');

    // Attach response metadata
    const responseMeta = new Metadata();
    responseMeta.add('x-processed-by', 'hero-node-1');
    call.sendMetadata(responseMeta);

    return this.heroes.find((h) => h.id === data.id);
  }
}
```

---

## 4. NestJS v12 gRPC Status-Specific Exceptions

In previous versions, throwing an `RpcException` without a numeric code returned a generic `UNKNOWN` status to callers.

NestJS v12 ships first-class, status-specific exception classes mapped directly to the `GrpcStatus` enum:

```typescript
import {
  GrpcAlreadyExistsException,
  GrpcNotFoundException,
  GrpcInvalidArgumentException,
  GrpcResourceExhaustedException,
  GrpcException,
  GrpcStatus,
} from '@nestjs/microservices';

@GrpcMethod('HeroesService', 'CreateHero')
createHero(dto: { name: string; power: string }): Hero {
  if (this.heroes.some((h) => h.name === dto.name)) {
    // Client receives ALREADY_EXISTS (Code 6)
    throw new GrpcAlreadyExistsException(`Hero "${dto.name}" already exists`);
  }

  if (!dto.name) {
    // Client receives INVALID_ARGUMENT (Code 3)
    throw new GrpcInvalidArgumentException('Hero name is required');
  }

  // Or throw generic GrpcException with custom status:
  // throw new GrpcException('Quota exceeded', GrpcStatus.RESOURCE_EXHAUSTED);

  const hero: Hero = { id: this.heroes.length + 1, ...dto };
  this.heroes.push(hero);
  return hero;
}
```

---

## 5. Client Consumption (`ClientGrpc`)

```typescript
// src/app.service.ts
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable } from 'rxjs';

interface HeroesService {
  findOne(data: { id: number }): Observable<Hero>;
  createHero(data: { name: string; power: string }): Observable<Hero>;
}

@Injectable()
export class AppService implements OnModuleInit {
  private heroesService!: HeroesService;

  constructor(
    @Inject('HERO_PACKAGE') private readonly client: ClientGrpc,
  ) {}

  onModuleInit(): void {
    // Service method names are converted to lower camelCase automatically
    this.heroesService = this.client.getService<HeroesService>('HeroesService');
  }

  getHero(id: number): Observable<Hero> {
    return this.heroesService.findOne({ id });
  }
}
```

---

## 6. Full-Duplex gRPC Streaming

gRPC supports client streaming, server streaming, and bidirectional full-duplex streaming:

```typescript
// src/hero/stream.controller.ts
import { Controller } from '@nestjs/common';
import { GrpcStreamMethod } from '@nestjs/microservices';
import { Observable, Subject } from 'rxjs';
import { Metadata, ServerDuplexStream } from '@grpc/grpc-js';

@Controller()
export class StreamController {
  @GrpcStreamMethod('HeroesService', 'BidiHeroSync')
  bidiHeroSync(
    messages: Observable<{ id: number }>,
    metadata: Metadata,
    call: ServerDuplexStream<any, any>,
  ): Observable<{ status: string }> {
    const output$ = new Subject<{ status: string }>();

    messages.subscribe({
      next: (req) => {
        output$.next({ status: `Synchronized hero #${req.id}` });
      },
      complete: () => output$.complete(),
    });

    return output$.asObservable();
  }
}
```

---

## 7. gRPC Reflection & Standard Health Checks

Enable runtime schema reflection for debugging tools (Postman, `grpc-ui`, `grpcurl`) and Kubernetes readiness probes:

```bash
pnpm add @grpc/reflection grpc-health-check
```

```typescript
import { ReflectionService } from '@grpc/reflection';
import { HealthImplementation, protoPath as healthCheckProtoPath } from 'grpc-health-check';

const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
  transport: Transport.GRPC,
  options: {
    package: ['hero', 'grpc.health.v1'],
    protoPath: [
      join(import.meta.dirname, 'hero/hero.proto'),
      healthCheckProtoPath,
    ],
    onLoadPackageDefinition: (pkg, server) => {
      // 1. Enable Reflection
      new ReflectionService(pkg).addToServer(server);

      // 2. Enable Health Probe Specification
      const health = new HealthImplementation({ '': 'SERVING' });
      health.addToServer(server);
    },
  },
});
```
