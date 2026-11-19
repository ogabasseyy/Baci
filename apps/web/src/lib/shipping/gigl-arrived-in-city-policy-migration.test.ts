import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GIGL_ARRIVED_IN_CITY_RAW_STATUS } from './gigl-tracking-notification-policy-matrix';

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations/20261119100000_gigl_arrived_in_city_notification.sql'
);

describe('arrived-in-city policy rows', () => {
  it('seeds both customer policy rows with the exact synthetic raw status the normalizer emits', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    for (const kind of ['arrived_in_city', 'transit_started']) {
      expect(sql).toContain(
        `('${GIGL_ARRIVED_IN_CITY_RAW_STATUS}', NULL, 'customer', '${kind}')`
      );
    }
  });
});
