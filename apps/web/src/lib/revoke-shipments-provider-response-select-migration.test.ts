import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903220000_revoke_shipments_provider_response_select.sql'
  ),
  'utf8'
);

describe('revoke shipments provider_response select migration', () => {
  it('removes provider_response from authenticated shipment grants', () => {
    expect(sql).toContain('REVOKE SELECT ON TABLE public.shipments');
    expect(sql).toContain('GRANT SELECT (');
    expect(sql).not.toContain('items, provider_response');
    expect(sql).toContain('sender_address, receiver_address, items,');
  });
});
