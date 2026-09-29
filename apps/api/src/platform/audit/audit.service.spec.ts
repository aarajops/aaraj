import { auditEvent } from './audit-schema.js';
import { AuditService, type AuditEventInput } from './audit.service.js';
import type { AuditTransaction } from './audit.types.js';

describe('AuditService', () => {
  it('appends the event through the caller transaction', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'audit-event-id' }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const transaction = { insert } as unknown as AuditTransaction;
    const event: AuditEventInput = {
      actorType: 'user',
      actorId: 'staff-user-id',
      eventType: 'access.staff_role.granted',
      subjectType: 'user',
      subjectId: 'target-user-id',
      reason: 'Support onboarding',
      metadata: { role: 'customer-service' },
    };

    await expect(new AuditService().append(transaction, event)).resolves.toBe(
      'audit-event-id',
    );
    expect(insert).toHaveBeenCalledWith(auditEvent);
    expect(values).toHaveBeenCalledWith({
      actorType: 'user',
      actorId: 'staff-user-id',
      eventType: 'access.staff_role.granted',
      subjectType: 'user',
      subjectId: 'target-user-id',
      requestId: undefined,
      reason: 'Support onboarding',
      metadata: { role: 'customer-service' },
    });
  });
});
