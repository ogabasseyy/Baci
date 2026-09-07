import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('validate repair pickup receiver phone migration', () => {
  it('requires a usable repair-center phone before exposing pickup quotes', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260903130000_validate_repair_pickup_receiver_phone.sql'
      ),
      'utf8'
    );

    expect(migration).toContain('is_usable_repair_pickup_phone');
    expect(migration).toContain('release_repair_pickup_booking_claim');
    expect(migration).toContain(
      "AND public.is_usable_repair_pickup_phone(\n              settings.repair_settings ->> 'contact_phone'\n            )"
    );
  });
});
