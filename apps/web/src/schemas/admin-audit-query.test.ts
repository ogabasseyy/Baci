import { describe, expect, it } from 'vitest';
import {
  adminAuditExportSchema,
  adminAuditQuerySchema,
} from './admin-audit-query';

describe('adminAuditQuerySchema', () => {
  it('accepts a complete keyset cursor and bounded filters', () => {
    const result = adminAuditQuerySchema.safeParse({
      action: 'audit.exported',
      beforeId: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1',
      beforeOccurredAt: '2026-08-05T10:00:00.000Z',
      beforeSource: 'platform',
      limit: '99',
      resourceType: 'audit_timeline',
      source: 'platform',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(99);
  });

  it('rejects a partial keyset cursor', () => {
    const result = adminAuditQuerySchema.safeParse({
      beforeOccurredAt: '2026-08-05T10:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects oversize pages and unsafe filter values', () => {
    expect(
      adminAuditQuerySchema.safeParse({
        action: 'email@example.com',
        limit: 100,
      }).success
    ).toBe(false);
  });

  it('keeps exports limited to current filters without cursor controls', () => {
    const result = adminAuditExportSchema.safeParse({
      beforeId: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1',
      source: 'canonical',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ source: 'canonical' });
    }
  });
});
