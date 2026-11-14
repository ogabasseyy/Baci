import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { primaryRestrictedReadinessRequirements } from './primary-restricted-readiness.constants';

const migrationRoles = {
  onboarding_role: 'piggyvest_primary_provisioner',
  provisioning_role: 'piggyvest_primary_goal_provisioner',
} as const;

function signaturesIn(statement: string) {
  return [...statement.matchAll(/([\w]+\.[\w]+)\s*\(([^()]*)\)/g)].map(
    ([, name, argumentsList]) =>
      `${name.toLowerCase()}(${argumentsList.replaceAll(/\s+/g, '').toLowerCase()})`
  );
}

function roleList(statement: string, keyword: 'TO' | 'FROM') {
  const match = statement
    .replace(/;$/, '')
    .match(keyword === 'TO' ? /\bTO\s+(.+)$/i : /\bFROM\s+(.+)$/i);
  return match
    ? match[1]
        .split(',')
        .map((role) => role.trim().replaceAll('"', '').toLowerCase())
    : [];
}

function migrationGrantsTo(migrations: string[], role: string) {
  const granted = new Set<string>();
  const statements =
    /\b(GRANT|REVOKE)\s+(?:EXECUTE|ALL)\s+ON\s+FUNCTION\b[\s\S]*?;/gi;

  for (const sql of migrations) {
    const uncommented = sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '');
    for (const match of uncommented.matchAll(statements)) {
      const statement = match[0];
      const action = match[1].toUpperCase();
      const roles = roleList(statement, action === 'GRANT' ? 'TO' : 'FROM');
      if (!roles.includes(role.toLowerCase())) continue;

      for (const signature of signaturesIn(statement)) {
        if (action === 'GRANT') granted.add(signature);
        else granted.delete(signature);
      }
    }
  }

  return [...granted].sort();
}

async function currentPiggyVestMigrationSources() {
  const directory = resolve(__dirname, '../../../../../supabase/migrations');
  const entries = await readdir(directory, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    migrationFiles.map((file) => readFile(resolve(directory, file), 'utf8'))
  );
}

describe('PiggyVest primary readiness migration grant source contract', () => {
  it('applies explicit function grants and later function revokes in migration order', () => {
    const initial =
      'GRANT EXECUTE ON FUNCTION piggyvest_primary.read_goal_wallet(jsonb, uuid), piggyvest_primary.prepare_goal_wallet(jsonb, uuid, boolean) TO piggyvest_primary_goal_provisioner;';
    const revoke =
      'REVOKE ALL ON FUNCTION piggyvest_primary.prepare_goal_wallet(jsonb, uuid, boolean) FROM PUBLIC, piggyvest_primary_goal_provisioner;';
    expect(
      migrationGrantsTo([initial, revoke], migrationRoles.provisioning_role)
    ).toEqual(['piggyvest_primary.read_goal_wallet(jsonb,uuid)']);
    const grants = migrationGrantsTo(
      [
        initial,
        revoke,
        'GRANT EXECUTE ON FUNCTION piggyvest_primary.prepare_goal_wallet(jsonb, uuid, boolean) TO piggyvest_primary_goal_provisioner;',
      ],
      migrationRoles.provisioning_role
    );

    expect(grants).toEqual([
      'piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean)',
      'piggyvest_primary.read_goal_wallet(jsonb,uuid)',
    ]);
  });

  it.each(
    Object.entries(migrationRoles)
  )('matches %s readiness signatures to explicit SQL grants, subject to later revokes', async (gate, role) => {
    const migrationSources = await currentPiggyVestMigrationSources();
    const grantedSignatures = migrationGrantsTo(migrationSources, role);
    const capability = primaryRestrictedReadinessRequirements.capabilities.find(
      (entry) => entry.gate === gate
    );

    expect(capability).toBeDefined();
    if (!capability) throw new Error(`Missing readiness capability: ${gate}`);
    expect(new Set(capability.functions).size).toBe(
      capability.functions.length
    );
    expect([...capability.functions].sort()).toEqual(grantedSignatures);
  });
});
