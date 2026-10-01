import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../supabase/migrations/20260912090500_uba_redvault_attempt_api.sql'
  ),
  'utf8'
);

describe('REDVAULT attempt API migration', () => {
  it('keeps customer-scoped initialization state and URL reuse out of direct table access', () => {
    expect(migration).toContain('authorization_url text');
    expect(migration).toContain("'initializing'");
    expect(migration).toContain(
      'claim_storefront_redvault_payment_attempt_initialization'
    );
    expect(migration).toContain(
      'record_storefront_redvault_payment_attempt_initialization'
    );
    expect(migration).toContain("'^[0-9]{3}$'");
    expect(migration).not.toContain("'^\\\\d{3}$'");
    expect(migration).toContain(
      "p_state NOT IN ('initialized', 'indeterminate')"
    );
    expect(migration).toContain('redvault_customer_context_required');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_storefront_redvault_payment_attempt_initialization(uuid, text, text) TO authenticated'
    );
    expect(migration).toContain('payment_method text');
    expect(migration).toContain('o.payment_method');
    expect(migration).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.record_storefront_redvault_payment_attempt_initialization(uuid, text, text) TO anon'
    );
    expect(migration).not.toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) TO anon'
    );
  });
});
