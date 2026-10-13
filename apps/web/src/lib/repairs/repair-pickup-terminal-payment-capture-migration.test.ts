import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903090000_repair_pickup_terminal_payment_capture.sql'
  ),
  'utf8'
);

describe('repair pickup terminal payment capture migration', () => {
  it('records verified payments even when the repair is already terminal', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.confirm_repair_pickup_payment'
    );
    expect(migration).toContain("'completed', 'cancelled', 'rejected'");
    expect(migration).toContain("WHEN v_terminal THEN 'review'");
    expect(migration).toContain('terminal_at_capture');
  });
});
