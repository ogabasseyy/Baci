import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function resolveMigrationPath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

const migrationFiles = {
  historical: '20260727220050_shipment_tracking_realtime_broadcast.sql',
  repair: '20260803000600_repair_gigl_tracking_realtime_broadcast.sql',
} as const;

const policyNames = [
  'authorized users receive shipment tracking wakeups',
  'shipment tracking topics require order access',
] as const;

function readMigration(filename: string) {
  return readFileSync(
    resolveMigrationPath(`../../../../../supabase/migrations/${filename}`),
    'utf8'
  );
}

function extractPolicyBody(migration: string, policyName: string) {
  const policyStart = migration
    .toLowerCase()
    .indexOf(`create policy "${policyName.toLowerCase()}"`);
  const policyEnd = migration.indexOf(';', policyStart);
  const policyBody =
    policyStart >= 0 && policyEnd >= 0
      ? migration.slice(policyStart, policyEnd + 1)
      : undefined;
  expect(policyBody).toBeDefined();
  return policyBody ?? '';
}

describe('GIGL tracking Realtime migration', () => {
  it('treats policy names as literal text instead of regular expressions', () => {
    const migration = 'CREATE POLICY "policy [literal]" ON realtime.messages;';

    expect(extractPolicyBody(migration, 'policy [literal]')).toBe(migration);
  });

  it('keeps the historical source and validates the append-only repair', () => {
    const historicalMigration = readMigration(migrationFiles.historical);
    const repairMigration = readMigration(migrationFiles.repair);

    for (const policyName of policyNames) {
      const historicalPolicy = extractPolicyBody(
        historicalMigration,
        policyName
      );
      expect(
        historicalPolicy.match(
          /pg_catalog\.substring\(realtime\.topic\(\) FROM 16\)::uuid/g
        )
      ).toHaveLength(1);
      expect(historicalPolicy).not.toContain(
        'pg_catalog.substr(realtime.topic(), 16)::uuid'
      );

      const policyBody = extractPolicyBody(repairMigration, policyName);
      expect(
        policyBody.match(/pg_catalog\.substr\(realtime\.topic\(\), 16\)::uuid/g)
      ).toHaveLength(1);
      expect(policyBody).not.toContain(
        'pg_catalog.substring(realtime.topic() FROM 16)'
      );
    }
  });
});
