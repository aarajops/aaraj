import type { getDrizzleDatabase } from '../database/database-client.js';

export type AuditTransaction = Parameters<
  Parameters<ReturnType<typeof getDrizzleDatabase>['transaction']>[0]
>[0];
