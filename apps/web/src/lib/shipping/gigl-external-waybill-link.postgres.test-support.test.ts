import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import {
  link,
  order,
  proof,
} from './gigl-external-waybill-link.postgres.test-support';

describe('external waybill PostgreSQL test support', () => {
  it('signs a proof bound to the order and quotes it safely for SQL', () => {
    const routeProof = proof(order('a'));
    expect(routeProof).toMatchObject({
      action: 'link_external_gigl_waybill',
      subject_id: order('a'),
    });
    expect(JSON.parse(routeProof.payload_text)).toMatchObject({
      waybill: '2000000001',
      account_verified: true,
    });
    const sql = link(order('a'), { note: "it's" });
    expect(sql).toContain(
      "public.link_external_gigl_waybill('41000000-0000-4000-8000-00000000000a'"
    );
    expect(sql).toContain("it''s");
  });
});
