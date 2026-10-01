import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { serviceRoleCredentialAuthority } from './event-pipeline-service-role-credential-analysis';

describe('serviceRoleCredentialAuthority', () => {
  it.each([
    'process.env.SUPABASE_SERVICE_ROLE_KEY',
    "process.env['SUPABASE_' + 'SERVICE_ROLE_KEY']",
    "const key = 'SUPABASE_SERVICE_ROLE_KEY'; process.env[key]",
    "Reflect.get(process.env, 'SUPABASE_' + 'SERVICE_ROLE_KEY')",
    'const { SUPABASE_SERVICE_ROLE_KEY: key } = process.env; use(key)',
    "const { ['SUPABASE_SERVICE_ROLE_KEY']: key } = process.env; use(key)",
    "const name = 'SUPABASE_SERVICE_ROLE_KEY'; const { [name]: key } = process.env; use(key)",
  ])('detects a service-role credential read: %s', (source) => {
    expect(
      serviceRoleCredentialAuthority.readsCredential('worker.ts', source)
    ).toBe(true);
  });

  it.each([
    'process.env.SUPABASE_ADS_CREDENTIAL_KEY',
    "process.env['SUPABASE_' + 'ADS_CREDENTIAL_KEY']",
    "const key = 'SUPABASE_ADS_CREDENTIAL_KEY'; process.env[key]",
    "Reflect.get(process.env, 'SUPABASE_' + 'ADS_CREDENTIAL_KEY')",
    'const { SUPABASE_ADS_CREDENTIAL_KEY: key } = process.env; use(key)',
    "const { ['SUPABASE_ADS_CREDENTIAL_KEY']: key } = process.env; use(key)",
    "const name = 'SUPABASE_ADS_CREDENTIAL_KEY'; const { [name]: key } = process.env; use(key)",
  ])('detects the dedicated Ads credential read: %s', (source) => {
    expect(
      serviceRoleCredentialAuthority.readsCredential('worker.ts', source)
    ).toBe(true);
  });

  it('ignores string literals and comments without a credential read', () => {
    expect(
      serviceRoleCredentialAuthority.readsCredential(
        'worker.ts',
        "// SUPABASE_SERVICE_ROLE_KEY\nthrow new Error('SUPABASE_SERVICE_ROLE_KEY')"
      )
    ).toBe(false);
  });

  it('detects a service-role credential read inside JSX', () => {
    expect(
      serviceRoleCredentialAuthority.readsCredential(
        'worker.jsx',
        'export const View = () => condition ? <div /> : <div data-key={process.env.SUPABASE_SERVICE_ROLE_KEY} />;'
      )
    ).toBe(true);
  });

  it('fails closed for an unclassified production reader and hash drift', () => {
    const source = 'process.env.SUPABASE_SERVICE_ROLE_KEY';
    const sources = new Map([
      ['unclassified.ts', source],
      ['allowed.ts', source],
    ]);
    expect(
      serviceRoleCredentialAuthority.findings(sources, {
        approvedTask6ReaderHashes: {},
        preExistingReaderHashes: {
          'allowed.ts': createHash('sha256').update('different').digest('hex'),
        },
        testSupportReaderHashes: {},
      })
    ).toEqual([
      'allowed.ts: pre-existing service-role credential reader hash drift',
      'unclassified.ts: unclassified production service-role credential read',
    ]);
  });

  it('ignores test and spec modules across supported extensions', () => {
    const sources = new Map([
      ['worker.test.ts', 'process.env.SUPABASE_SERVICE_ROLE_KEY'],
      ['worker.spec.tsx', 'process.env.SUPABASE_SERVICE_ROLE_KEY'],
      ['worker.test.mjs', 'process.env.SUPABASE_SERVICE_ROLE_KEY'],
    ]);
    expect(
      serviceRoleCredentialAuthority.findings(sources, {
        approvedTask6ReaderHashes: {},
        preExistingReaderHashes: {},
        testSupportReaderHashes: {},
      })
    ).toEqual([]);
  });

  it('retains tracked maintenance authority while retiring the RLS analytics route reader', () => {
    const paths = Object.keys(
      serviceRoleCredentialAuthority.ledgers.preExistingReaderHashes
    );

    expect(paths).toEqual(
      expect.arrayContaining([
        'apps/web/scripts-tmp/check-cdn-access.ts',
        'scripts-tmp/check-cdn-access.ts',
        'scripts/backfill-feed-images.ts',
      ])
    );
    expect(paths).not.toContain(
      'apps/web/src/app/api/platform/analytics-config/route.ts'
    );
  });
});
