import { describe, expect, it } from 'vitest';
import { createAdminAuditCsv } from './admin-audit-csv';

describe('createAdminAuditCsv', () => {
  it('exports only the safe projection and escapes spreadsheet formulas', () => {
    const csv = createAdminAuditCsv([
      {
        action: '=dangerous.formula',
        actorKind: 'Platform admin',
        changedFields: ['is_published', 'name'],
        eventId: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1',
        eventSource: 'platform',
        occurredAt: '2026-08-05T10:00:00.000Z',
        resourceType: 'merchant_settings',
      },
    ]);

    expect(csv).toContain("'=dangerous.formula");
    expect(csv).toContain('is_published, name');
    expect(csv).not.toContain('d8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1');
    expect(csv).not.toContain('before_values');
  });
});
