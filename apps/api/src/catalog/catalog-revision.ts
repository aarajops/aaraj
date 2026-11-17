import {
  BadRequestException,
  HttpException,
  HttpStatus,
  PreconditionFailedException,
} from "@nestjs/common";

export type CatalogEditableResource = "category" | "product" | "size-guide";

export function catalogEditEtag(
  resource: CatalogEditableResource,
  resourceId: string,
  revision: number,
): string {
  return `"catalog-${resource}:${resourceId}:r${revision}"`;
}

export function requireCatalogEditRevision(
  ifMatch: string | undefined,
  resource: CatalogEditableResource,
  resourceId: string,
): number {
  if (ifMatch === undefined) {
    throw new HttpException(
      `If-Match is required. Reload the ${resource} before saving.`,
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }

  const match =
    /^"catalog-(category|product|size-guide):([0-9a-f-]{36}):r([1-9][0-9]*)"$/i.exec(
      ifMatch,
    );
  if (!match || match[1] !== resource) {
    throw new BadRequestException(
      `If-Match must contain this ${resource}'s current ETag.`,
    );
  }
  if (match[2]?.toLowerCase() !== resourceId.toLowerCase()) {
    throw new PreconditionFailedException(
      `If-Match does not match this ${resource}.`,
    );
  }

  const revision = Number(match[3]);
  if (!Number.isSafeInteger(revision)) {
    throw new PreconditionFailedException(
      `If-Match does not match the current ${resource} revision.`,
    );
  }
  return revision;
}
