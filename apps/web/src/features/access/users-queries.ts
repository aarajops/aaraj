import "server-only";

import { headers } from "next/headers";
import {
  AccessRoleCatalogSchema,
  AccessUserListQuerySchema,
  AccessUserPageSchema,
  API_V1_BASE_PATH,
  type AccessUserListQuery,
  type AccessRoleCatalog,
  type AccessUserPage,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

export type UsersPageSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
  search?: string | string[];
};

const defaultQuery = AccessUserListQuerySchema.parse({});

export function parseUsersPageQuery(
  searchParams: UsersPageSearchParams,
): AccessUserListQuery {
  if (
    Array.isArray(searchParams.limit) ||
    Array.isArray(searchParams.offset) ||
    Array.isArray(searchParams.search)
  ) {
    return defaultQuery;
  }

  const result = AccessUserListQuerySchema.safeParse(searchParams);
  return result.success ? result.data : defaultQuery;
}

type ManagedUsersResult =
  | { page: AccessUserPage; roles: AccessRoleCatalog }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

export async function getManagedUsers(
  query: AccessUserListQuery,
): Promise<ManagedUsersResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    if (query.search) search.set("search", query.search);
    const requestHeaders = new Headers();
    if (cookie) requestHeaders.set("cookie", cookie);
    const requestOptions: RequestInit = {
      headers: requestHeaders,
      cache: "no-store" as const,
    };
    const [usersResponse, rolesResponse] = await Promise.all([
      fetch(
        `${getApiInternalUrl()}${API_V1_BASE_PATH}/access/users?${search}`,
        requestOptions,
      ),
      fetch(
        `${getApiInternalUrl()}${API_V1_BASE_PATH}/access/roles`,
        requestOptions,
      ),
    ]);
    if (usersResponse.status === 401 || rolesResponse.status === 401) {
      return { kind: "unauthenticated" };
    }
    if (usersResponse.status === 403 || rolesResponse.status === 403) {
      return { kind: "forbidden" };
    }
    if (!usersResponse.ok || !rolesResponse.ok) return { kind: "unavailable" };

    const [usersBody, rolesBody] = await Promise.all([
      usersResponse.json(),
      rolesResponse.json(),
    ]);
    const page = AccessUserPageSchema.safeParse(usersBody);
    const roles = AccessRoleCatalogSchema.safeParse(rolesBody);
    return page.success && roles.success
      ? { page: page.data, roles: roles.data }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
