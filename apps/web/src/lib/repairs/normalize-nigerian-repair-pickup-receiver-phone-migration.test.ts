import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('normalize Nigerian repair pickup receiver phone migration', () => {
  it('converts local trunk phones like 09070007000 before the usable-phone gate', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260904160000_normalize_nigerian_repair_pickup_receiver_phone.sql'
      ),
      'utf8'
    );

    expect(migration).toContain('normalize_repair_pickup_phone_digits');
    expect(migration).toContain("'234' || substring(digits FROM 2)");
    expect(migration).toContain(
      "COALESCE(\n      public.normalize_repair_pickup_phone_digits(p_phone),\n      ''\n    ) ~ '^[1-9][0-9]{7,14}$'"
    );
  });
});
