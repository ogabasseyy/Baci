import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (name) =>
  readFileSync(
    new URL(`./official-managed-prerequisites-${name}`, import.meta.url),
    'utf8'
  );

export function officialManagedPrerequisites({
  systemIdentifier,
  schemaOnlyReviewed,
} = {}) {
  if (
    typeof systemIdentifier !== 'string' ||
    !/^[1-9][0-9]{15,19}$/.test(systemIdentifier) ||
    schemaOnlyReviewed !== true
  )
    throw new Error(
      'Explicit isolated cluster identity and schema-only review required'
    );
  const provenance = JSON.parse(read('sources.json'));
  for (const [name, sha256] of Object.entries(provenance.assets)) {
    if (
      !/^(auth|graphql|realtime)\.sql$/.test(name) ||
      createHash('sha256').update(read(name)).digest('hex') !== sha256
    )
      throw new Error('Official managed SQL asset integrity mismatch');
  }
  const sql = [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL statement_timeout = '60s';",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL client_min_messages = 'error';",
    `SELECT set_config('baci.expected_system_identifier', '${systemIdentifier}', true) IS NOT NULL AS identity_supplied;`,
    read('boundary.sql'),
    read('triggers.sql'),
    read('snapshot.sql'),
    read('install.sql'),
    read('pg-stat-statements.sql'),
    read('graphql.sql'),
    read('realtime.sql'),
    read('grants.sql'),
    read('verify.sql'),
    read('boundary.sql'),
    `DO $preserved$ BEGIN
      IF pg_temp.managed_preserved_state() IS DISTINCT FROM (SELECT value FROM managed_preserved_snapshot) THEN
        RAISE EXCEPTION 'Auth, Storage or existing roles changed; rolling back';
      END IF;
    END $preserved$;`,
    'COMMIT;',
    "SELECT 'official-managed-prerequisites: schema-only verified; operational Realtime unsupported' AS result;",
  ].join('\n');
  return Object.freeze({
    sql,
    launchReady: false,
    realtimeOperational: false,
    postgresImage: provenance.postgresImage,
  });
}
