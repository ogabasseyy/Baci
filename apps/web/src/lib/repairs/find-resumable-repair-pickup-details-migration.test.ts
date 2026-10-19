import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('find resumable repair pickup return details migration', () => {
  it('returns pickup-binding fields for resume reclaim checks', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260904170000_find_resumable_repair_pickup_return_details.sql'
      ),
      'utf8'
    );

    expect(migration).toContain('device_type text');
    expect(migration).toContain('device_model text');
    expect(migration).toContain('customer_phone text');
    expect(migration).toContain('pickup_address text');
    expect(migration).toContain('repair.pickup_address');
  });
});
