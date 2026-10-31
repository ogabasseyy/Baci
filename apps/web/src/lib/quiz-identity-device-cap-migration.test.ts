import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  resolve(
    currentDirectory,
    '../../../../supabase/migrations/20260714102200_quiz_identity_and_device_caps.sql'
  ),
  'utf8'
);
const identityDeviceTestSql = [
  'quiz_identity_device_caps.sql',
  'quiz_identity_device_caps.helpers.inc.sql',
]
  .map((file) =>
    readFileSync(
      resolve(currentDirectory, '../../../../supabase/migrations/tests', file),
      'utf8'
    )
  )
  .join('\n');
const leaderboardTestSql = readFileSync(
  resolve(
    currentDirectory,
    '../../../../supabase/migrations/tests/quiz_leaderboard_neutral_ranking.sql'
  ),
  'utf8'
);

describe('quiz identity and device cap migration', () => {
  it('installs an authenticated device-cap readiness marker', () => {
    expect(migrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.quiz_device_cap_ready\(\)/i
    );
    expect(migrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.quiz_device_cap_ready\(\) TO authenticated, service_role/i
    );
  });

  it('canonicalizes googlemail aliases to gmail identities', () => {
    expect(migrationSql).toMatch(
      /IF v_domain = 'googlemail\.com' THEN\s+v_domain := 'gmail\.com'/i
    );
    expect(migrationSql).toMatch(
      /IF v_domain = 'gmail\.com' THEN\s+v_local := pg_catalog\.split_part\(v_local, '\+', 1\)/i
    );
  });

  it('does not collapse plus signs for unconfigured email providers', () => {
    expect(
      migrationSql.match(/pg_catalog\.split_part\(v_local, '\+', 1\)/gi)
    ).toHaveLength(1);
  });

  it('rejects email identities with multiple separators', () => {
    expect(migrationSql).toMatch(
      /pg_catalog\.length\(v_email\)[\s\S]*?pg_catalog\.replace\(v_email, '@', ''\)[\s\S]*?<> 1/i
    );
    expect(identityDeviceTestSql).toContain(
      "quiz_normalize_email('victim@gmail.com@invalid')"
    );
  });

  it('serializes identity-cap checks before counting attempts', () => {
    const identityFunction = migrationSql.match(
      /CREATE OR REPLACE FUNCTION public\.quiz_enforce_identity_attempt_cap[\s\S]*?\$\$;/i
    )?.[0];

    expect(identityFunction).toBeDefined();
    expect(identityFunction).toMatch(/pg_advisory_xact_lock/i);
    expect(identityFunction?.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      identityFunction?.indexOf('SELECT pg_catalog.count(*)') ?? -1
    );
  });

  it('persists device-cap disqualification and returns a rejected result', () => {
    const bindFunction = migrationSql.match(
      /CREATE FUNCTION public\.bind_quiz_attempt_device[\s\S]*?\$\$;/i
    )?.[0];
    const internalBindFunction = migrationSql.match(
      /CREATE FUNCTION public\.quiz_bind_attempt_device_internal[\s\S]*?\$\$;/i
    )?.[0];

    expect(bindFunction).toBeDefined();
    expect(internalBindFunction).toBeDefined();
    expect(bindFunction).toMatch(/RETURNS boolean/i);
    expect(bindFunction).toMatch(/v_user_id := auth\.uid\(\)/i);
    expect(bindFunction).not.toMatch(/p_user_id uuid/i);
    expect(bindFunction).toMatch(
      /quiz_route_proof_valid[\s\S]*?'bind_quiz_attempt_device_v1'/i
    );
    expect(bindFunction).toMatch(
      /quiz_route_proof_valid\(\s*p_route_proof,\s*'bind_quiz_attempt_device_v1',\s*public\.quiz_device_proof_subject\(p_attempt_id, p_device_hash\),\s*v_user_id\s*\)/i
    );
    expect(bindFunction).not.toMatch(
      /quiz_route_proof_valid\([\s\S]*?pg_catalog\.jsonb_build_object/i
    );
    expect(bindFunction).toMatch(/quiz_bind_attempt_device_internal/i);
    expect(internalBindFunction).toMatch(
      /SELECT d\.device_hash[\s\S]*?v_bound_device_hash[\s\S]*?IS DISTINCT FROM p_device_hash/i
    );
    expect(migrationSql).toMatch(/allowed boolean NOT NULL DEFAULT true/i);
    expect(internalBindFunction).toMatch(
      /GET DIAGNOSTICS v_binding_rows = ROW_COUNT/i
    );
    expect(internalBindFunction).toMatch(
      /IF v_binding_rows = 0 THEN[\s\S]*?RETURN COALESCE\(v_existing_allowed, false\)/i
    );
    expect(internalBindFunction).toMatch(
      /UPDATE public\.quiz_attempt_devices[\s\S]*?SET allowed = false/i
    );
    expect(internalBindFunction).toMatch(
      /DELETE FROM public\.quiz_attempt_questions[\s\S]*?WHERE attempt_id = p_attempt_id/i
    );
    expect(internalBindFunction).toMatch(
      /UPDATE public\.quiz_attempts[\s\S]*?status = 'disqualified'[\s\S]*?RETURN false;/i
    );
    expect(internalBindFunction).not.toMatch(
      /RAISE EXCEPTION 'quiz_device_attempt_limit'/i
    );
    expect(internalBindFunction).toMatch(/RETURN true;/i);
    expect(migrationSql).toMatch(
      /DROP FUNCTION IF EXISTS public\.bind_quiz_attempt_device\(uuid, text, jsonb\)/i
    );
    expect(migrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.bind_quiz_attempt_device\(uuid, text, jsonb\) TO authenticated;/i
    );
    expect(migrationSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.bind_quiz_attempt_device[^;]*service_role/i
    );
  });

  it('starts and device-binds in one transaction before returning data', () => {
    const atomicStartFunction = migrationSql.match(
      /CREATE FUNCTION public\.start_quiz_attempt_with_device[\s\S]*?\$\$;/i
    )?.[0];

    expect(atomicStartFunction).toBeDefined();
    const dropIndex = migrationSql.indexOf(
      'DROP FUNCTION IF EXISTS public.start_quiz_attempt_with_device(uuid, text, text, jsonb, jsonb, uuid)'
    );
    const createIndex = migrationSql.indexOf(
      'CREATE FUNCTION public.start_quiz_attempt_with_device('
    );
    expect(dropIndex).toBeGreaterThanOrEqual(0);
    expect(dropIndex).toBeLessThan(createIndex);
    expect(atomicStartFunction).toMatch(
      /quiz_route_proof_valid[\s\S]*?'start_quiz_attempt_with_device_v1'/i
    );
    expect(atomicStartFunction).toMatch(
      /public\.quiz_device_proof_subject\(p_event_id, p_device_hash\)/i
    );
    expect(atomicStartFunction).toMatch(/v_auth_user_id := auth\.uid\(\)/i);
    expect(atomicStartFunction).toMatch(
      /v_auth_user_id IS NULL OR v_auth_user_id IS DISTINCT FROM p_user_id/i
    );
    expect(atomicStartFunction).toMatch(/public\.start_quiz_attempt\(/i);
    expect(atomicStartFunction).toMatch(
      /public\.quiz_bind_attempt_device_internal\(/i
    );
    expect(
      atomicStartFunction?.indexOf('public.start_quiz_attempt(')
    ).toBeLessThan(
      atomicStartFunction?.indexOf(
        'public.quiz_bind_attempt_device_internal('
      ) ?? -1
    );
    expect(atomicStartFunction).not.toMatch(/\bWHEN\s+OTHERS\b/i);
    expect(atomicStartFunction).toMatch(/SQLSTATE '55P03'/i);
    expect(atomicStartFunction).toMatch(/SQLSTATE '57014'/i);
    expect(atomicStartFunction).toMatch(/SQLSTATE '40001'/i);
    expect(atomicStartFunction).toMatch(/SQLSTATE '40P01'/i);
    expect(atomicStartFunction).toMatch(/'deviceBindingFailed'/i);
    expect(migrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.start_quiz_attempt_with_device[\s\S]*?TO authenticated;/i
    );
  });

  it('keeps raw device hashes out of proof validation subjects', () => {
    const subjectFunction = migrationSql.match(
      /CREATE OR REPLACE FUNCTION public\.quiz_device_proof_subject[\s\S]*?\$\$;/i
    )?.[0];

    expect(subjectFunction).toBeDefined();
    expect(subjectFunction).toMatch(/extensions\.digest/i);
    expect(subjectFunction).toMatch(/'sha256'/i);
    expect(subjectFunction).toMatch(
      /p_scope_id::text \|\| ':' \|\| p_device_hash/i
    );
    expect(migrationSql).not.toMatch(
      /quiz_route_proof_valid\([\s\S]*?p_(?:attempt|event)_id::text \|\| ':' \|\| p_device_hash/i
    );
    expect(identityDeviceTestSql).not.toMatch(
      /public\.quiz_device_proof_subject/i
    );
    expect(identityDeviceTestSql).toMatch(
      /extensions\.digest\(p_attempt_id::text \|\| ':' \|\| p_device_hash, 'sha256'\)/i
    );
  });

  it('uses valid attempt statuses in the SQL regression fixture', () => {
    expect(identityDeviceTestSql).not.toContain("'in_progress'");
    expect(identityDeviceTestSql).toContain("'started'");
  });

  it('exercises the normalized email identity cap in the SQL fixture', () => {
    expect(identityDeviceTestSql).toContain('identity.player+one@gmail.com');
    expect(identityDeviceTestSql).toContain('identityplayer@gmail.com');
    expect(identityDeviceTestSql).toMatch(/EXCEPTION WHEN SQLSTATE 'QZ040'/i);
  });

  it('keeps the neutral-ranking fixture above the identity attempt count', () => {
    expect(leaderboardTestSql).toMatch(
      /INSERT INTO public\.quiz_events \(id, merchant_id, slug, title, status, settings\)[\s\S]*?'\{"max_attempts":10\}'::jsonb/i
    );
  });
});
