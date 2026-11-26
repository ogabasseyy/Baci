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

  it('pushes only the arrival when one scan queues both customer rows', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain("skip_reason = 'covered_by_arrival_push'");
    expect(sql).toContain("transit.notification_kind = 'transit_started'");
    expect(sql).toContain(
      'arrival.tracking_event_id = transit.tracking_event_id'
    );
    // Statement-level, so the row-level shipped-email trigger runs first.
    expect(sql).toContain('REFERENCING NEW TABLE AS inserted_outbox');
  });
});
