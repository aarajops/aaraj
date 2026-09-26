# Operations & Responses

> **Domain**: OpenAPI Path Operations, Response Modeling & Hierarchical Tagging  
> **Source Reference**: [NestJS OpenAPI Operations](https://docs.nestjs.com/openapi/operations)  
> **Package**: `@nestjs/swagger`  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

In OpenAPI terminology, **Paths** represent the endpoint URLs exposed by your API (such as `/api/v1/orders`), while **Operations** correspond to the HTTP methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) used to interact with those paths.

---

## 1. Tagging & OpenAPI 3.2 Tag Hierarchies

Tags group related operations together in documentation interfaces and client SDKs.

### Standard Tagging

Apply `@ApiTags()` at the controller or method level:

```typescript
// apps/api/src/cats/cats.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('cats')
@Controller('cats')
export class CatsController {
  @Get()
  findAll() {
    return [];
  }
}
```

### OpenAPI 3.2 Hierarchical Tags & Presentation Hints

OpenAPI 3.2 introduces structured tag hierarchies and presentation hints (`kind`). You can establish parent-child navigation trees by defining tags upfront in `DocumentBuilder`:

```typescript
// apps/api/src/main.ts
import { DocumentBuilder } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('Enterprise Service')
  .setVersion('1.0.0')
  .setOpenAPIVersion('3.2.0') // Mandatory for OpenAPI 3.2 schema validation
  .addTag('Inventory', 'Core catalog and supply chain', undefined, { kind: 'nav' })
  .addTag('Products', 'Product catalog management', undefined, { parent: 'Inventory' })
  .addTag('Warehouses', 'Physical stock distribution', undefined, { parent: 'Inventory' })
  .build();
```

| Option | Type | Description |
| :--- | :--- | :--- |
| `parent` | `string` | The parent tag identifier establishing tree grouping. |
| `kind` | `string` | Presentation hint for UI renderers: commonly `'nav'`, `'badge'`, or `'audience'`. |
| `summary` | `string` | Short title displayed alongside the tag. |

> [!WARNING]
> Tag hierarchy fields (`parent`, `kind`) are valid only in OpenAPI 3.2. You **must** call `.setOpenAPIVersion('3.2.0')` on `DocumentBuilder`; otherwise, strict schema validators will reject the specification. Furthermore, hierarchy options must be configured via `DocumentBuilder.addTag()`; the `@ApiTags()` decorator ignores them.

---

## 2. Request Headers

To document custom HTTP headers required by an endpoint:

```typescript
import { ApiHeader } from '@nestjs/swagger';

@ApiHeader({
  name: 'X-Tenant-ID',
  description: 'Unique multi-tenant organization UUID',
  required: true,
})
@Controller('orders')
export class OrdersController {}
```

---

## 3. Responses & Shorthand Decorators

Document return statuses and schemas using `@ApiResponse()` or its status-specific shorthands:

```typescript
// apps/api/src/cats/cats.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CatEntity } from './entities/cat.entity.js';
import { CreateCatDto } from './dto/create-cat.dto.js';

@ApiTags('cats')
@Controller('cats')
export class CatsController {
  @Post()
  @ApiCreatedResponse({
    description: 'Cat resource successfully created',
    type: CatEntity,
  })
  @ApiBadRequestResponse({ description: 'Payload validation failed' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  @ApiConflictResponse({ description: 'A cat with this microchip already exists' })
  async create(@Body() dto: CreateCatDto): Promise<CatEntity> {
    return new CatEntity();
  }
}
```

### Full Shorthand Response Decorators Catalog

Nest provides purpose-built decorators for all standard HTTP statuses:

| Decorator | HTTP Status Code | Description |
| :--- | :--- | :--- |
| `@ApiOkResponse()` | `200 OK` | Successful retrieval or general request. |
| `@ApiCreatedResponse()` | `201 Created` | Successful resource creation. |
| `@ApiAcceptedResponse()` | `202 Accepted` | Async batch processing queued. |
| `@ApiNoContentResponse()` | `204 No Content` | Successful execution with empty body. |
| `@ApiBadRequestResponse()` | `400 Bad Request` | Client validation failure or bad syntax. |
| `@ApiUnauthorizedResponse()`| `401 Unauthorized` | Missing or invalid authentication token. |
| `@ApiForbiddenResponse()` | `403 Forbidden` | Authenticated caller lacks permissions. |
| `@ApiNotFoundResponse()` | `404 Not Found` | Target resource does not exist. |
| `@ApiConflictResponse()` | `409 Conflict` | Unique constraint violation. |
| `@ApiUnprocessableEntityResponse()` | `422 Unprocessable` | Semantic entity validation error. |
| `@ApiTooManyRequestsResponse()` | `429 Too Many` | Rate limit quota exceeded. |
| `@ApiInternalServerErrorResponse()`| `500 Server Error` | Unexpected runtime crash. |
| `@ApiServiceUnavailableResponse()` | `503 Unavailable` | Downstream dependency or breaker open. |
| `@ApiDefaultResponse()` | Default catch-all | Generic fallback status. |

---

## 4. Multipart File Uploads

To document file uploads, declare `@ApiConsumes('multipart/form-data')` and supply a binary schema:

```typescript
// apps/api/src/files/dto/file-upload.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class FileUploadDto {
  @ApiProperty({ type: 'string', format: 'binary' })
  file!: unknown;
}

export class MultiFileUploadDto {
  @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' } })
  files!: unknown[];
}
```

```typescript
// apps/api/src/files/files.controller.ts
import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { FileUploadDto } from './dto/file-upload.dto.js';

@ApiTags('files')
@Controller('files')
export class FilesController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Document upload binary payload',
    type: FileUploadDto,
  })
  @ApiOkResponse({ description: 'File uploaded successfully' })
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return { filename: file.originalname, size: file.size };
  }
}
```

---

## 5. Generic Paginated Responses (`ApiPaginatedResponse`)

A common architectural challenge is documenting generic paginated envelopes (e.g., `PaginatedDto<T>`). Because TypeScript erases generics at runtime, Swagger cannot infer the dynamic element type of `results: T[]`.

### Step 1: Base Paginated DTO

```typescript
// apps/api/src/common/dto/paginated.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class PaginatedDto<TData> {
  @ApiProperty({ example: 100 })
  total!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;

  results!: TData[]; // Left undecorated; injected dynamically below
}
```

### Step 2: Custom Composable Decorator with Client SDK Title Support

```typescript
// apps/api/src/common/decorators/api-paginated-response.decorator.ts
import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginatedDto } from '../dto/paginated.dto.js';

export const ApiPaginatedResponse = <TModel extends Type<any>>(model: TModel) => {
  return applyDecorators(
    ApiExtraModels(PaginatedDto, model),
    ApiOkResponse({
      schema: {
        // Explicit title ensures client SDK generators create 'PaginatedResponseOfCatEntity'
        title: `PaginatedResponseOf${model.name}`,
        allOf: [
          { $ref: getSchemaPath(PaginatedDto) },
          {
            properties: {
              results: {
                type: 'array',
                items: { $ref: getSchemaPath(model) },
              },
            },
          },
        ],
      },
    }),
  );
};
```

### Step 3: Usage in Controllers

```typescript
@Get()
@ApiPaginatedResponse(CatEntity)
async findAll(): Promise<PaginatedDto<CatEntity>> {
  return {
    total: 1,
    limit: 20,
    offset: 0,
    results: [new CatEntity()],
  };
}
```

Client code generators (such as Orval or NSwag) will generate clean, unambiguous return types:
```typescript
findAll(): Observable<PaginatedResponseOfCatEntity>;
```
