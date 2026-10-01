import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName =
  '20260821180000_provider_neutral_ads_storage.sql' as const;
const migrationHash =
  '1bc92dcee4cef48f4a30747ee378c81c3f0483e573d159df3b367bf7edee632d' as const;
const hardeningMigrationName =
  '20260821180001_harden_provider_neutral_ads_rpcs.sql' as const;
const hardeningMigrationHash =
  'c5dc059fe41ebed2824b0d9b6275bd8d58b691c5cb561fc039bb80348834d563' as const;
const metaReauthMigrationName =
  '20260821180002_meta_ads_reauth_status.sql' as const;
const metaReauthMigrationHash =
  'f0c8ee6d1f3b7b3e2eb06380c8be94fe797ed9781c1ba00d59b49ea1836b589c' as const;
const metaReauthAllowlistMigrationName =
  '20260821180003_expand_meta_ads_reauth_reason_allowlist.sql' as const;
const metaReauthAllowlistMigrationHash =
  '4312b9ad198bd16bb8bf20191e786e24a34a97f928da5e9031399f6a7da47960' as const;
const snapchatSecurityMigrationName =
  '20260821180004_snapchat_ads_oauth_and_disconnect.sql' as const;
const snapchatSecurityMigrationHash =
  'eac8c22a9d2d2ad1decbde111f60921b880cf478f4123d3441b5e0e291ccb3ca' as const;
const snapchatRefreshMigrationName =
  '20260821180005_snapchat_ads_atomic_refresh_tokens.sql' as const;
const snapchatRefreshMigrationHash =
  'c71e54d8a1ea2af6809ecc50d6e6582358806501eb851f17861dfab611f10359' as const;
const providerNeutralNonceMigrationName =
  '20260821180006_provider_neutral_ads_oauth_state_nonces.sql' as const;
const providerNeutralNonceMigrationHash =
  '7def866f396dced9ceb5c914e67b640c3765e25d9c59032bae78f10fa31d4dc3' as const;
const providerNeutralNonceHardeningMigrationName =
  '20260821180007_harden_provider_neutral_ads_oauth_state_nonce_rpcs.sql' as const;
const providerNeutralNonceHardeningMigrationHash =
  '55d645a37189cf63da021741d225888f6eb867c92f07bb0d05ffc3ee28b96f45' as const;
const adsReviewFindingsMigrationName =
  '20260823190000_harden_ads_review_findings.sql' as const;
const adsReviewFindingsMigrationHash =
  '3ba9981390574c940e3d90fb0ac3991bce39cb9625f5d0e31e2c185c88bbb56f' as const;
const googleAdsReauthMigrationName =
  '20260823200000_google_ads_reauth_status.sql' as const;
const googleAdsReauthMigrationHash =
  '7cc5b5c148990cb0cc0b7cb8ed98c6fe374dcc43fd3e7fef5db91c6563c92332' as const;
const googleAdsReauthClearAccountMigrationName =
  '20260823210000_google_ads_reauth_clear_account.sql' as const;
const googleAdsReauthClearAccountMigrationHash =
  'dc328a575fba02e3fd64e470bcc328e27152d183e8c572f27c79d338e40e652d' as const;
const googleAdsSyncConsistencyMigrationName =
  '20260823220000_google_ads_sync_consistency.sql' as const;
const googleAdsSyncConsistencyMigrationHash =
  '70cf6954955961e3fcd923aac9c2512e54062ef5936d51c066faa3db23caeca3' as const;
const socialAdsSpendWindowMigrationName =
  '20260824090000_replace_social_ads_spend_window.sql' as const;
const socialAdsSpendWindowMigrationHash =
  '2e34f6488ad7bcd213fe9c08adf0353b789d7c6e0f017928276d64cd42cb5a5e' as const;
const analyticsSpendRlsMigrationName =
  '20260824100000_require_analytics_permission_for_ad_spend.sql' as const;
const analyticsSpendRlsMigrationHash =
  '822bf6c91081f0b36cd0568d85cd5f500bb91182d36d5fb9b35ba72e3491cde7' as const;
const accountAwareSyncMarkerMigrationName =
  '20260824110000_account_aware_ads_sync_marker.sql' as const;
const accountAwareSyncMarkerMigrationHash =
  '7b693e30176a0c500614d933161ba7e6dd03ec0468e250a3a99ac7d618c7b7b3' as const;
const adsCredentialBoundaryMigrationName =
  '20260826090000_restrict_ads_credential_rpcs_to_service_role.sql' as const;
const adsCredentialBoundaryMigrationHash =
  'a191c7045cb7e2efe1a160f0d7656f0cd433feb9a43f00fa48801fd1ffe91ca1' as const;
const prerequisiteMigrations = [
  '20260821171051_google_ads_connections_and_spend.sql',
  '20260821174945_google_ads_secret_rpcs.sql',
] as const;

describe('provider-neutral ads migration replay inventory', () => {
  it('registers the exact migration hash in both replay source inventories', () => {
    const migration = readFileSync(
      path.resolve(process.cwd(), `../../supabase/migrations/${migrationName}`)
    );
    const historySources = [
      readFileSync(
        path.resolve(
          process.cwd(),
          'tools/db/supabase-history-replay-sources.ts'
        ),
        'utf8'
      ),
      readFileSync(
        path.resolve(
          process.cwd(),
          'tools/db/supabase-history-replay-ads-pending-sources.ts'
        ),
        'utf8'
      ),
    ].join('\n');
    const pendingSources = readFileSync(
      path.resolve(
        process.cwd(),
        'tools/db/recent-pending-sources.test-fixture.ts'
      ),
      'utf8'
    );

    expect(createHash('sha256').update(migration).digest('hex')).toBe(
      migrationHash
    );
    expect(historySources).toContain(`${migrationHash} ${migrationName}`);
    expect(pendingSources).toContain(migrationName);
    expect(pendingSources).toContain(migrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${hardeningMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(hardeningMigrationHash);
    expect(historySources).toContain(
      `${hardeningMigrationHash} ${hardeningMigrationName}`
    );
    expect(pendingSources).toContain(hardeningMigrationName);
    expect(pendingSources).toContain(hardeningMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${metaReauthMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(metaReauthMigrationHash);
    expect(historySources).toContain(
      `${metaReauthMigrationHash} ${metaReauthMigrationName}`
    );
    expect(pendingSources).toContain(metaReauthMigrationName);
    expect(pendingSources).toContain(metaReauthMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${metaReauthAllowlistMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(metaReauthAllowlistMigrationHash);
    expect(historySources).toContain(
      `${metaReauthAllowlistMigrationHash} ${metaReauthAllowlistMigrationName}`
    );
    expect(pendingSources).toContain(metaReauthAllowlistMigrationName);
    expect(pendingSources).toContain(metaReauthAllowlistMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${snapchatSecurityMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(snapchatSecurityMigrationHash);
    expect(historySources).toContain(
      `${snapchatSecurityMigrationHash} ${snapchatSecurityMigrationName}`
    );
    expect(pendingSources).toContain(snapchatSecurityMigrationName);
    expect(pendingSources).toContain(snapchatSecurityMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${snapchatRefreshMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(snapchatRefreshMigrationHash);
    expect(historySources).toContain(
      `${snapchatRefreshMigrationHash} ${snapchatRefreshMigrationName}`
    );
    expect(pendingSources).toContain(snapchatRefreshMigrationName);
    expect(pendingSources).toContain(snapchatRefreshMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${providerNeutralNonceMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(providerNeutralNonceMigrationHash);
    expect(historySources).toContain(
      `${providerNeutralNonceMigrationHash} ${providerNeutralNonceMigrationName}`
    );
    expect(pendingSources).toContain(providerNeutralNonceMigrationName);
    expect(pendingSources).toContain(providerNeutralNonceMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${providerNeutralNonceHardeningMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(providerNeutralNonceHardeningMigrationHash);
    expect(historySources).toContain(
      `${providerNeutralNonceHardeningMigrationHash} ${providerNeutralNonceHardeningMigrationName}`
    );
    expect(pendingSources).toContain(
      providerNeutralNonceHardeningMigrationName
    );
    expect(pendingSources).toContain(
      providerNeutralNonceHardeningMigrationHash
    );
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${adsReviewFindingsMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(adsReviewFindingsMigrationHash);
    expect(historySources).toContain(
      `${adsReviewFindingsMigrationHash} ${adsReviewFindingsMigrationName}`
    );
    expect(pendingSources).toContain(adsReviewFindingsMigrationName);
    expect(pendingSources).toContain(adsReviewFindingsMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${googleAdsReauthMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(googleAdsReauthMigrationHash);
    expect(historySources).toContain(
      `${googleAdsReauthMigrationHash} ${googleAdsReauthMigrationName}`
    );
    expect(pendingSources).toContain(googleAdsReauthMigrationName);
    expect(pendingSources).toContain(googleAdsReauthMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${googleAdsReauthClearAccountMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(googleAdsReauthClearAccountMigrationHash);
    expect(historySources).toContain(
      `${googleAdsReauthClearAccountMigrationHash} ${googleAdsReauthClearAccountMigrationName}`
    );
    expect(pendingSources).toContain(googleAdsReauthClearAccountMigrationName);
    expect(pendingSources).toContain(googleAdsReauthClearAccountMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${googleAdsSyncConsistencyMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(googleAdsSyncConsistencyMigrationHash);
    expect(historySources).toContain(
      `${googleAdsSyncConsistencyMigrationHash} ${googleAdsSyncConsistencyMigrationName}`
    );
    expect(pendingSources).toContain(googleAdsSyncConsistencyMigrationName);
    expect(pendingSources).toContain(googleAdsSyncConsistencyMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${socialAdsSpendWindowMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(socialAdsSpendWindowMigrationHash);
    expect(historySources).toContain(
      `${socialAdsSpendWindowMigrationHash} ${socialAdsSpendWindowMigrationName}`
    );
    expect(pendingSources).toContain(socialAdsSpendWindowMigrationName);
    expect(pendingSources).toContain(socialAdsSpendWindowMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${analyticsSpendRlsMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(analyticsSpendRlsMigrationHash);
    expect(historySources).toContain(
      `${analyticsSpendRlsMigrationHash} ${analyticsSpendRlsMigrationName}`
    );
    expect(pendingSources).toContain(analyticsSpendRlsMigrationName);
    expect(pendingSources).toContain(analyticsSpendRlsMigrationHash);
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            path.resolve(
              process.cwd(),
              `../../supabase/migrations/${accountAwareSyncMarkerMigrationName}`
            )
          )
        )
        .digest('hex')
    ).toBe(accountAwareSyncMarkerMigrationHash);
    expect(historySources).toContain(
      `${accountAwareSyncMarkerMigrationHash} ${accountAwareSyncMarkerMigrationName}`
    );
    expect(pendingSources).toContain(accountAwareSyncMarkerMigrationName);
    expect(pendingSources).toContain(accountAwareSyncMarkerMigrationHash);
  });

  it('ships and orders the Google baseline before provider-neutral storage', () => {
    const historySources = [
      readFileSync(
        path.resolve(
          process.cwd(),
          'tools/db/supabase-history-replay-sources.ts'
        ),
        'utf8'
      ),
      readFileSync(
        path.resolve(
          process.cwd(),
          'tools/db/supabase-history-replay-ads-pending-sources.ts'
        ),
        'utf8'
      ),
    ].join('\n');
    const pendingSources = readFileSync(
      path.resolve(
        process.cwd(),
        'tools/db/recent-pending-sources.test-fixture.ts'
      ),
      'utf8'
    );

    for (const prerequisite of prerequisiteMigrations) {
      expect(
        readFileSync(
          path.resolve(
            process.cwd(),
            `../../supabase/migrations/${prerequisite}`
          ),
          'utf8'
        )
      ).not.toBe('');
      expect(historySources).toContain(prerequisite);
      expect(pendingSources).toContain(prerequisite);
      expect(historySources.indexOf(prerequisite)).toBeLessThan(
        historySources.indexOf(migrationName)
      );
    }
  });

  it('registers the service-only Ads credential boundary migration', () => {
    const migration = readFileSync(
      path.resolve(
        process.cwd(),
        `../../supabase/migrations/${adsCredentialBoundaryMigrationName}`
      )
    );
    const historySources = [
      readFileSync(
        path.resolve(
          process.cwd(),
          'tools/db/supabase-history-replay-sources.ts'
        ),
        'utf8'
      ),
      readFileSync(
        path.resolve(
          process.cwd(),
          'tools/db/supabase-history-replay-ads-pending-sources.ts'
        ),
        'utf8'
      ),
    ].join('\n');
    const pendingSources = readFileSync(
      path.resolve(
        process.cwd(),
        'tools/db/recent-pending-sources.test-fixture.ts'
      ),
      'utf8'
    );

    expect(createHash('sha256').update(migration).digest('hex')).toBe(
      adsCredentialBoundaryMigrationHash
    );
    expect(historySources).toContain(
      `${adsCredentialBoundaryMigrationHash} ${adsCredentialBoundaryMigrationName}`
    );
    expect(pendingSources).toContain(adsCredentialBoundaryMigrationName);
    expect(pendingSources).toContain(adsCredentialBoundaryMigrationHash);
  });
});
