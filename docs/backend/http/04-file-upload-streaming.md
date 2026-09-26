# 04 - File Upload and Streaming

> **Source Reference**: [NestJS Official Documentation - File Upload](https://docs.nestjs.com/http/file-upload)

Handling binary files is a core requirement for web backends—both for ingesting client file uploads (`multipart/form-data`) and for streaming binary files (PDF reports, media assets, data exports) back to clients.

NestJS provides a unified, cross-platform architecture:
- In Express, upload processing is powered by **Multer** (`@nestjs/platform-express`).
- In Fastify (NestJS v12.1+), upload processing is powered by **`@fastify/multipart`** (`@nestjs/platform-fastify/multipart`), with support for **zero-buffer streaming uploads**.
- Binary egress is unified using the **`StreamableFile`** abstraction.

---

## 1. Upload Interceptors Overview

NestJS maps multipart form fields to route handler parameters via interceptors and decorators:

| Interceptor | Description | Extraction Decorator |
| :--- | :--- | :--- |
| `FileInterceptor(fieldName, options?)` | Single file in specified field | `@UploadedFile()` |
| `FilesInterceptor(fieldName, maxCount?, options?)` | Array of files with same field name | `@UploadedFiles()` |
| `FileFieldsInterceptor(fieldArray, options?)` | Multiple files across distinct field names | `@UploadedFiles()` |
| `AnyFilesInterceptor(options?)` | Files in arbitrary, dynamic field names | `@UploadedFiles()` |
| `NoFilesInterceptor()` | Rejects all files, populates multipart text to `req.body` | `@Body()` |

---

## 2. Express Uploads (Multer)

### Installation

```bash
pnpm --filter @araz/api add -D @types/multer
```

### Single File Upload with Disk Storage

```typescript
// src/media/media.controller.ts
import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';

@Controller('media')
export class MediaController {
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: './uploads/avatars',
        filename: (req, file, callback) => {
          const uniqueId = randomUUID();
          const ext = extname(file.originalname);
          callback(null, `${uniqueId}${ext}`);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB
      },
    }),
  )
  uploadAvatar(@UploadedFile() file: Express.Multer.File) {
    return {
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      path: file.path,
    };
  }
}
```

### Multiple Fields & Array Uploads

```typescript
// src/media/media-batch.controller.ts
import { Controller, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';

@Controller('media-batch')
export class MediaBatchController {
  @Post('gallery')
  @UseInterceptors(FilesInterceptor('photos', 10))
  uploadGallery(@UploadedFiles() files: Array<Express.Multer.File>) {
    return { count: files.length, names: files.map((f) => f.originalname) };
  }

  @Post('profile-assets')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'avatar', maxCount: 1 },
      { name: 'cover', maxCount: 1 },
      { name: 'documents', maxCount: 5 },
    ]),
  )
  uploadProfileAssets(
    @UploadedFiles()
    files: {
      avatar?: Express.Multer.File[];
      cover?: Express.Multer.File[];
      documents?: Express.Multer.File[];
    },
  ) {
    return {
      hasAvatar: Boolean(files.avatar?.[0]),
      hasCover: Boolean(files.cover?.[0]),
      documentCount: files.documents?.length ?? 0,
    };
  }
}
```

---

## 3. Robust File Validation

NestJS provides `ParseFilePipe` and `ParseFilePipeBuilder` to validate incoming file metadata and content before reaching controller logic.

### Built-in Validators: Size and Magic Number MIME Check

`FileTypeValidator` verifies the MIME type using **magic numbers** (the binary signature at the start of the file), preventing attacks where a malicious executable is renamed with an `.png` extension.

```typescript
// src/media/validated-upload.controller.ts
import {
  Controller,
  HttpStatus,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('documents')
export class DocumentsController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('document'))
  uploadDocument(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /(pdf|docx|odt)$/,
        })
        .addMaxSizeValidator({
          maxSize: 10 * 1024 * 1024, // 10 MB
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          fileIsRequired: true,
        }),
    )
    file: Express.Multer.File,
  ) {
    return { status: 'accepted', filename: file.originalname };
  }
}
```

### Custom `FileValidator`

```typescript
// src/common/validators/image-dimension.validator.ts
import { FileValidator } from '@nestjs/common';

export interface DimensionOptions {
  minWidth: number;
  minHeight: number;
}

export class ImageDimensionValidator extends FileValidator<DimensionOptions> {
  isValid(file?: Express.Multer.File): boolean {
    if (!file || !file.buffer) return false;
    // Inspect image header bytes for width/height bounds
    return true;
  }

  buildErrorMessage(file: Express.Multer.File): string {
    return `File ${file.originalname} does not satisfy minimum dimensions (${this.validationOptions.minWidth}x${this.validationOptions.minHeight})`;
  }
}
```

---

## 4. Fastify Uploads & Streaming (`@fastify/multipart`)

Starting with NestJS v12.1, Fastify applications use the identical interceptor API backed by `@fastify/multipart`.

```bash
pnpm --filter @araz/api add @fastify/multipart
```

### Zero-Buffering Streaming Upload (`FileStreamInterceptor`)

In high-throughput systems, buffering 100MB+ files to RAM or temp disk wastes resources. Fastify offers `FileStreamInterceptor`, providing a direct readable stream to pipe straight into Cloud Storage (S3 / GCS) or disk:

```typescript
// src/media/streaming-upload.controller.ts
import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import {
  FileStreamInterceptor,
  MultipartFileStream,
} from '@nestjs/platform-fastify/multipart';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

@Controller('stream-upload')
export class StreamUploadController {
  @Post('video')
  @UseInterceptors(
    FileStreamInterceptor('video', {
      limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB limit
    }),
  )
  async uploadVideo(
    @UploadedFile() file: MultipartFileStream,
    @Body() body: Record<string, string>,
  ) {
    const targetPath = join(process.cwd(), 'storage', `${randomUUID()}-${file.originalname}`);
    // Pipe directly without buffering in Node memory
    await pipeline(file.stream, createWriteStream(targetPath));

    return {
      status: 'uploaded',
      filename: file.originalname,
      targetPath,
      metadata: body,
    };
  }
}
```

> [!IMPORTANT]
> **Rules for Streaming Uploads**:
> 1. Form text fields must **precede** the file field in the HTML form payload for them to be parsed into `req.body`.
> 2. Only one file field is accepted per stream.
> 3. Magic number validation is bypassed since the file is not pre-buffered.

---

## 5. Streaming Files to Clients (`StreamableFile`)

Directly calling `res.pipe()` bypasses NestJS interceptor pipelines and exception filters. Always return an instance of **`StreamableFile`**:

```typescript
// src/reports/reports.controller.ts
import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';

@Controller('reports')
export class ReportsController {
  @Get(':id/pdf')
  downloadPdf(@Param('id') id: string): StreamableFile {
    const filePath = join(process.cwd(), 'reports', `${id}.pdf`);
    const fileStream = createReadStream(filePath);
    const stats = statSync(filePath);

    return new StreamableFile(fileStream, {
      type: 'application/pdf',
      disposition: `attachment; filename="report-${id}.pdf"`,
      length: stats.size,
    });
  }

  @Get(':id/protected-export')
  exportData(): StreamableFile {
    const fileStream = createReadStream(join(process.cwd(), 'export.csv'));

    return new StreamableFile(fileStream).setErrorHandler((err, res) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.statusCode = 404;
      res.send('Requested export file not found or corrupted');
    });
  }
}
```

### Key Advantages of `StreamableFile`

- **Cross-Platform**: Functions identically under both Express and Fastify.
- **Backpressure Handling**: Automatically synchronizes stream chunks with TCP socket drainage, preventing memory leaks during slow client downloads.
- **Clean Teardown**: Automatically handles stream destruction and socket cleanup if client connections drop prematurely.
