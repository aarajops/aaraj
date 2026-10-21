import "client-only";

import { API_V1_BASE_PATH, type AssignedRole } from "@aaraj/contracts";

export function fetchEffectiveAccess(): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/access/me`, { cache: "no-store" });
}

export function changeManagedUserRole(
  userId: string,
  role: AssignedRole,
  action: "grant" | "revoke",
  reason: string,
): Promise<Response> {
  return fetch(
    `${API_V1_BASE_PATH}/access/users/${encodeURIComponent(userId)}/roles/${role}`,
    {
      method: action === "grant" ? "PUT" : "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );
}
