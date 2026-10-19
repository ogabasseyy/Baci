import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../../supabase/migrations/20260825000300_claim_jumia_discovery_and_fix_handoff.sql'
  ),
  'utf8'
);
const ttlMigration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../../supabase/migrations/20260831140000_extend_jumia_discovery_claim_ttl.sql'
  ),
  'utf8'
);

describe('Jumia discovery claim migration', () => {
  it('claims rotating credentials atomically and supports release', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_jumia_self_authorization_discovery'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.release_jumia_self_authorization_discovery'
    );
    expect(migration).toContain('discovery.claim_token IS NULL');
  });

  it('qualifies handoff ticket columns returned from the insert', () => {
    expect(migration).toContain(
      'INSERT INTO public.oauth_handoff_tickets AS ticket'
    );
    expect(migration).toContain('RETURNING ticket.id, ticket.expires_at');
  });

  it('extends the discovery expiry through the active claim window', () => {
    expect(ttlMigration).toContain(
      "expires_at = GREATEST(discovery.expires_at, now() + interval '2 minutes')"
    );
  });
});
