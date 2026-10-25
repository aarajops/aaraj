"use client";

import { useState, useTransition, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { AssignedRoleSchema } from "@aaraj/contracts";
import type {
  AccessManagedUser,
  AccessRoleCatalog,
  AccessUserListQuery,
  AccessUserPage,
  AssignedRole,
  Permission,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { changeManagedUserRole } from "@/features/access/access-client";
import { getApiErrorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/date-time";
import { LoaderCircle } from "lucide-react";

const columnHelper = createDataTableColumnHelper<AccessManagedUser>();
type AssignableRole = {
  role: AssignedRole;
  permissions: readonly Permission[];
};

function getAssignableRoles(roleCatalog: AccessRoleCatalog): AssignableRole[] {
  return roleCatalog.flatMap(({ role, permissions }) => {
    const parsedRole = AssignedRoleSchema.safeParse(role);
    return parsedRole.success ? [{ role: parsedRole.data, permissions }] : [];
  });
}

export function UsersManager({
  actorId,
  page,
  query,
  roleCatalog,
}: {
  actorId: string;
  page: AccessUserPage;
  query: AccessUserListQuery;
  roleCatalog: AccessRoleCatalog;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AccessManagedUser | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assignableRoles = getAssignableRoles(roleCatalog);

  async function changeRole(
    target: AccessManagedUser,
    role: AssignedRole,
    action: "grant" | "revoke",
    reason: string,
  ): Promise<boolean> {
    setBusyUserId(target.id);
    setMessage(null);
    setError(null);
    try {
      const response = await changeManagedUserRole(
        target.id,
        role,
        action,
        reason,
      );
      if (!response.ok) {
        setError(
          getApiErrorMessage(
            await response.json().catch(() => null),
            "The role change was rejected. Refresh and try again.",
          ),
        );
        return false;
      }
      setMessage(
        `${role} access ${action === "grant" ? "granted to" : "removed from"} ${target.email}.`,
      );
      startRefresh(() => router.refresh());
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
      return false;
    } finally {
      setBusyUserId(null);
    }
  }

  const columns = columnHelper.columns([
    columnHelper.accessor("email", {
      header: "Account",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="min-w-48 space-y-1">
            <p className="truncate font-medium text-foreground">{user.name}</p>
            <p className="break-all text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>
        );
      },
    }),
    columnHelper.accessor("createdAt", {
      header: "Joined",
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {formatDateTime(getValue())}
        </span>
      ),
    }),
    columnHelper.accessor("roles", {
      header: "Access",
      cell: ({ getValue }) => (
        <div className="flex min-w-36 flex-wrap gap-1">
          {getValue().map((role) => (
            <Badge key={role} variant="outline">
              {role}
            </Badge>
          ))}
        </div>
      ),
    }),
    columnHelper.display({
      id: "role-actions",
      header: "Actions",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Button
          aria-label={`Manage access for ${row.original.email}`}
          disabled={busyUserId !== null || isRefreshing}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => {
            setMessage(null);
            setError(null);
            setSelectedUser(row.original);
          }}
        >
          Manage
        </Button>
      ),
    }),
  ]);

  return (
    <main className="min-h-[calc(100vh-3.5rem)] flex-1 px-5 py-8 text-foreground sm:px-8 sm:py-10">
      <div className="container mx-auto">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          User management
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Search accounts and manage staff access.
        </p>

        {message && (
          <p className="mt-4 text-sm text-success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <section aria-labelledby="user-directory-heading" className="mt-7">
          <h2 className="sr-only" id="user-directory-heading">
            Account directory
          </h2>
          <AdminDataTable
            ariaLabel="Users"
            columns={columns}
            data={page.users}
            emptyMessage={
              query.search
                ? "No matching users. Clear the search to browse all accounts."
                : "No accounts yet."
            }
            page={page}
            isRefreshing={isRefreshing || busyUserId !== null}
            itemName="users"
            onRefresh={() => startRefresh(() => router.refresh())}
            pathname="/admin/users"
            query={query}
            searchPlaceholder="Search by name or email"
          />
        </section>
      </div>

      <RoleManagementSheet
        key={selectedUser?.id ?? "closed"}
        actorId={actorId}
        assignableRoles={assignableRoles}
        busy={busyUserId !== null || isRefreshing}
        error={error}
        onChange={changeRole}
        onErrorClear={() => setError(null)}
        onOpenChange={(open) => {
          if (!open) setSelectedUser(null);
        }}
        open={selectedUser !== null}
        user={selectedUser}
      />
    </main>
  );
}

function RoleManagementSheet({
  actorId,
  assignableRoles,
  busy,
  error,
  onChange,
  onErrorClear,
  onOpenChange,
  open,
  user,
}: {
  actorId: string;
  assignableRoles: AssignableRole[];
  busy: boolean;
  error: string | null;
  onChange: (
    target: AccessManagedUser,
    role: AssignedRole,
    action: "grant" | "revoke",
    reason: string,
  ) => Promise<boolean>;
  onErrorClear: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  user: AccessManagedUser | null;
}) {
  const [selectedRole, setSelectedRole] = useState<AssignedRole | null>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const availableRoles =
    user && user.id !== actorId
      ? assignableRoles.filter(({ role }) => !user.roles.includes(role))
      : [];
  const grantRole = availableRoles.some(({ role }) => role === selectedRole)
    ? selectedRole
    : null;
  const selectedRoleOption = availableRoles.find(
    ({ role }) => role === grantRole,
  );
  const reasonIsValid =
    reason.trim().length >= 3 && reason.trim().length <= 500;

  async function updateRole(role: AssignedRole, action: "grant" | "revoke") {
    if (!user || !reasonIsValid) return;
    setIsSubmitting(true);
    try {
      if (await onChange(user, role, action, reason.trim())) {
        setReason("");
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {user && (
        <SheetContent
          className="w-full overflow-hidden p-0 sm:max-w-md"
          side="right"
        >
          <SheetHeader className="border-b border-border px-6 py-5 pr-14">
            <SheetTitle className="text-xl font-semibold">
              Manage access
            </SheetTitle>
            <SheetDescription>
              Role changes apply immediately and are audited.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-1">
              <p className="font-medium">{user.name}</p>
              <p className="break-all text-sm text-muted-foreground">
                {user.email}
              </p>
              <p className="text-sm text-muted-foreground">
                Email {user.emailVerified ? "verified" : "not verified"}
              </p>
            </div>

            {user.id === actorId && (
              <p className="text-sm text-muted-foreground">
                You are managing your own account. Removing your access can
                close this management view immediately.
              </p>
            )}

            <section
              aria-labelledby="current-roles-heading"
              className="space-y-2.5"
            >
              <h3 className="text-sm font-semibold" id="current-roles-heading">
                Current access
              </h3>
              <div className="flex flex-wrap gap-2">
                {user.roles.map((role) => (
                  <Badge key={role} variant="outline">
                    {role}
                  </Badge>
                ))}
              </div>
            </section>

            {availableRoles.length > 0 && (
              <form
                className="space-y-3 border-t border-border pt-5"
                onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  if (grantRole) void updateRole(grantRole, "grant");
                }}
              >
                <h3 className="text-sm font-semibold">Add a role</h3>
                <label
                  className="block text-sm font-medium"
                  htmlFor={`role-${user.id}`}
                >
                  Role to add
                </label>
                <Select
                  disabled={busy || isSubmitting}
                  itemToStringLabel={(value) => {
                    const parsedRole = AssignedRoleSchema.safeParse(value);
                    return parsedRole.success
                      ? formatRoleOption(parsedRole.data)
                      : String(value);
                  }}
                  value={grantRole ?? null}
                  onValueChange={(value) => {
                    const parsedRole = AssignedRoleSchema.safeParse(value);
                    if (!parsedRole.success) return;
                    onErrorClear();
                    setSelectedRole(parsedRole.data);
                  }}
                >
                  <SelectTrigger
                    aria-label={`Role to grant to ${user.email}`}
                    id={`role-${user.id}`}
                  >
                    <SelectValue placeholder="Choose a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map(({ role }) => (
                      <SelectItem key={role} value={role}>
                        {formatRoleOption(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <label
                  className="block text-sm font-medium"
                  htmlFor={`reason-${user.id}`}
                >
                  Reason <span className="text-destructive">*</span>
                </label>
                <Input
                  aria-label={`Reason for changing roles for ${user.email}`}
                  autoComplete="off"
                  className="h-10"
                  disabled={busy || isSubmitting}
                  id={`reason-${user.id}`}
                  maxLength={500}
                  minLength={3}
                  placeholder="Briefly explain this change"
                  required
                  value={reason}
                  onChange={(event) => {
                    onErrorClear();
                    setReason(event.target.value);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Saved to the audit log · 3–500 characters
                </p>
                {selectedRoleOption?.permissions.includes("access.manage") &&
                  selectedRoleOption.permissions.includes("audit.read") && (
                    <p className="text-sm text-muted-foreground">
                      This role can manage user access and read the audit log.
                      Grant it only to a trusted system owner.
                    </p>
                  )}
                <Button
                  aria-label={`Grant role to ${user.email}`}
                  className="w-full"
                  disabled={
                    busy || isSubmitting || !reasonIsValid || !grantRole
                  }
                  type="submit"
                >
                  {(busy || isSubmitting) && (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  )}
                  Grant {grantRole ? formatRoleOption(grantRole) : "role"}
                </Button>
              </form>
            )}

            {user.roles.some((role) => role !== "customer") && (
              <section
                aria-labelledby="remove-roles-heading"
                className="space-y-3 border-t border-border pt-5"
              >
                <h3 className="text-sm font-semibold" id="remove-roles-heading">
                  Remove a role
                </h3>
                <div className="flex flex-wrap gap-2">
                  {assignableRoles
                    .filter(({ role }) => user.roles.includes(role))
                    .map(({ role }) => (
                      <Button
                        key={role}
                        aria-label={`Revoke ${role}`}
                        disabled={
                          busy ||
                          isSubmitting ||
                          !reasonIsValid ||
                          !reason.trim()
                        }
                        size="sm"
                        type="button"
                        variant="destructive"
                        onClick={() => void updateRole(role, "revoke")}
                      >
                        Revoke {role}
                      </Button>
                    ))}
                </div>
              </section>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            {(busy || isSubmitting) && (
              <p
                aria-live="polite"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
                Saving access change…
              </p>
            )}
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}

function formatRoleOption(role: AssignedRole): string {
  return role.charAt(0).toLocaleUpperCase() + role.slice(1);
}
