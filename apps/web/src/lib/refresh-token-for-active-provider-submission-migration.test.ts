import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const previous = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903214000_refresh_token_for_active_provider_submission.sql'
  ),
  'utf8'
);

describe('refresh token for active provider submission migration', () => {
  it('historically rotated the attempt token for non-stale provider_submitting charges', () => {
    expect(previous).toContain("v_existing.status = 'provider_submitting'");
    expect(previous).toContain(
      "attempt_token_digest = pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex')"
    );
    expect(previous).toContain("'needs_reconciliation'");
    expect(previous).toContain('STALE_PROVIDER_SUBMISSION');
  });
});
