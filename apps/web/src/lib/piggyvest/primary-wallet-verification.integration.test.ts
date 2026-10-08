import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = path.resolve(
  sourceDirectory,
  '../../../../../supabase/migrations/20261007180000_piggyvest_primary_wallet_verification.sql'
);

const assertions = `
SET SESSION AUTHORIZATION primary_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  proof jsonb := '{"providerCustomerId":"customer","providerWalletId":"wallet","businessId":"fixture-business","currency":"NGN","status":"active","hasFundingAccount":true}';
  field text;
  invalid jsonb;
BEGIN
  IF piggyvest_primary.claim_onboarding(scope, repeat('a',64))->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'accepted intent was not pending';
  END IF;
  FOREACH field IN ARRAY ARRAY['providerCustomerId','providerWalletId'] LOOP
    IF piggyvest_primary.verify_onboarding(scope, jsonb_set(proof, ARRAY[field], '"foreign"')) THEN
      RAISE EXCEPTION 'adopted mismatched provider identity';
    END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['merchantId','customerId','userId','integrationId','businessId','environment'] LOOP
    BEGIN
      PERFORM piggyvest_primary.verify_onboarding(jsonb_set(scope, ARRAY[field],
        CASE WHEN field = 'businessId' THEN '"foreign"'::jsonb
          WHEN field = 'environment' THEN '"production"'::jsonb
          ELSE '"00000000-0000-4000-8000-000000000099"'::jsonb END), proof);
      RAISE EXCEPTION 'accepted foreign scope';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  FOREACH invalid IN ARRAY ARRAY[
    NULL::jsonb, 'null'::jsonb, '[]'::jsonb, '{}'::jsonb,
    proof - 'status', proof || '{"extra":true}'::jsonb,
    proof || '{"hasFundingAccount":false}'::jsonb,
    proof || '{"hasFundingAccount":"true"}'::jsonb,
    proof || '{"businessId":"foreign"}'::jsonb,
    proof || '{"currency":"USD"}'::jsonb,
    proof || '{"status":"pending"}'::jsonb,
    proof || '{"status":null}'::jsonb,
    proof || '{"providerWalletId":42}'::jsonb,
    proof || '{"providerCustomerId":""}'::jsonb
  ] LOOP
    BEGIN
      PERFORM piggyvest_primary.verify_onboarding(scope, invalid);
      RAISE EXCEPTION 'accepted invalid proof';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  IF NOT piggyvest_primary.verify_onboarding(scope, proof) THEN
    RAISE EXCEPTION 'accepted intent did not become verified';
  END IF;
  IF NOT piggyvest_primary.verify_onboarding(scope, proof) THEN
    RAISE EXCEPTION 'verification replay was not idempotent';
  END IF;
  IF piggyvest_primary.claim_onboarding(scope, repeat('a',64))->>'status' <> 'ready' THEN
    RAISE EXCEPTION 'repeated onboarding did not become ready';
  END IF;
  IF piggyvest_primary.claim_onboarding(scope, repeat('b',64))->>'status' <> 'conflict' THEN
    RAISE EXCEPTION 'verification weakened fingerprint fencing';
  END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  proof jsonb := '{"providerCustomerId":"customer","providerWalletId":"wallet","businessId":"fixture-business","currency":"NGN","status":"active","hasFundingAccount":true}';
  principal text;
  desired_state text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(principal,'piggyvest_primary.verify_onboarding(jsonb,jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'verification publicly executable';
    END IF;
  END LOOP;
  IF has_table_privilege('primary_fixture','piggyvest_primary.onboarding_intents','UPDATE') THEN
    RAISE EXCEPTION 'provisioner has direct update privilege';
  END IF;
  FOREACH desired_state IN ARRAY ARRAY['unknown','dispatched'] LOOP
    UPDATE piggyvest_primary.onboarding_intents SET
      state = desired_state, provider_customer_id = NULL, provider_wallet_id = NULL,
      claim_token = CASE WHEN desired_state = 'dispatched' THEN gen_random_uuid() ELSE NULL END;
    SET SESSION AUTHORIZATION primary_fixture;
    IF piggyvest_primary.verify_onboarding(scope, proof) THEN
      RAISE EXCEPTION 'verification adopted an uncertain or dispatched intent';
    END IF;
    IF piggyvest_primary.read_onboarding(scope) IS NOT NULL THEN
      RAISE EXCEPTION 'uncertain or dispatched identity became readable';
    END IF;
    IF piggyvest_primary.claim_onboarding(scope, repeat('a',64))->>'status' <> 'pending' THEN
      RAISE EXCEPTION 'uncertain or dispatched identity was dispatched again';
    END IF;
    RESET SESSION AUTHORIZATION;
  END LOOP;
END $$;
`;

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'promotes only an exact scoped accepted provider mapping and fences verification replays',
  () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'primary-wallet-verification-')
    );
    const dataDirectory = path.join(directory, 'data');
    const options = { encoding: 'utf8' as const, timeout: 15000 };
    let started = false;
    try {
      execFileSync(
        'initdb',
        [
          '-D',
          dataDirectory,
          '-U',
          'verification_owner',
          '-A',
          'trust',
          '--no-locale',
        ],
        options
      );
      execFileSync(
        'pg_ctl',
        [
          '-D',
          dataDirectory,
          '-l',
          path.join(directory, 'postgres.log'),
          '-o',
          `-k ${directory} -p 56483 -c listen_addresses=''`,
          '-w',
          'start',
        ],
        options
      );
      started = true;
      const connection = [
        '-h',
        directory,
        '-p',
        '56483',
        '-U',
        'verification_owner',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ];
      execFileSync(
        'psql',
        [
          ...connection,
          '-f',
          path.join(sourceDirectory, 'primary-wallet-storage.integration.sql'),
        ],
        options
      );
      execFileSync('psql', [...connection, '-f', migration], options);
      const output = execFileSync(
        'psql',
        [...connection, '-c', assertions],
        options
      );
      expect(output).toContain('DO');
    } finally {
      try {
        if (started)
          execFileSync(
            'pg_ctl',
            ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop'],
            options
          );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  30000
);
