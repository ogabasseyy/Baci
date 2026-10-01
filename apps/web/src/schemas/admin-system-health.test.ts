import { describe, expect, it } from 'vitest';
import { adminSystemHealthSchema } from './admin-system-health';

const validHealth = {
  checkedAt: '2026-08-05T15:00:00.000Z',
  health: [
    {
      check_name: 'Database query',
      details: { server_time: '2026-08-05T15:00:00.000Z' },
      message: 'The database responded.',
      status: 'healthy',
    },
  ],
  indexRecommendations: [
    {
      index_name: 'Review table indexes',
      priority: 'medium',
      reason: 'Sequential scans dominate.',
      table_name: 'orders',
    },
  ],
  missingIndexes: ['orders(merchant_id)'],
};

describe('adminSystemHealthSchema', () => {
  it('accepts the bounded system-health response', () => {
    expect(adminSystemHealthSchema.safeParse(validHealth).success).toBe(true);
  });

  it('rejects unknown statuses so a failed check cannot look healthy', () => {
    const result = adminSystemHealthSchema.safeParse({
      ...validHealth,
      health: [{ ...validHealth.health[0], status: 'ok' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid timestamps and incomplete recommendations', () => {
    const result = adminSystemHealthSchema.safeParse({
      ...validHealth,
      checkedAt: 'today',
      indexRecommendations: [{ table_name: 'orders' }],
    });

    expect(result.success).toBe(false);
  });
});
