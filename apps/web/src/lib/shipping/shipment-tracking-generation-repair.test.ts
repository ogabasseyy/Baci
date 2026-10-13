import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveGiglTrackingMigrationPath } from './gigl-tracking-migration-path';

const migrationFilename =
  '20260811090000_repair_shipment_tracking_generation_order_id_ambiguity.sql';

function readMigration() {
  const path = resolveGiglTrackingMigrationPath(
    `../../../../../supabase/migrations/${migrationFilename}`,
    migrationFilename
  );
  return readFileSync(path, 'utf8');
}

describe('shipment tracking generation repair migration', () => {
  it('avoids the PL/pgSQL order_id ambiguity in the conflict target', () => {
    const migration = readMigration();
    const functionDefinition =
      migration.match(
        /CREATE OR REPLACE FUNCTION private\.allocate_shipment_tracking_generation\([\s\S]*?\$\$;/i
      )?.[0] ?? '';

    expect(functionDefinition).toContain(
      'RETURNS TABLE (order_id uuid, tracking_timeline_generation integer)'
    );
    expect(functionDefinition).toContain(
      'ON CONFLICT ON CONSTRAINT order_tracking_timeline_generations_pkey DO UPDATE'
    );
    expect(functionDefinition).not.toContain(
      'ON CONFLICT (order_id) DO UPDATE'
    );
  });
});
