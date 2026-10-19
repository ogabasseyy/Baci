import { describe, expect, it } from 'vitest';
import { ADS_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-ads-pending-sources';

describe('supabase history replay ads pending sources', () => {
  it('registers the provider storage and reauthorization migrations', () => {
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260821180000_provider_neutral_ads_storage.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260823210000_google_ads_reauth_clear_account.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260823220000_google_ads_sync_consistency.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260824090000_replace_social_ads_spend_window.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260824110000_account_aware_ads_sync_marker.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260825130000_index_snapchat_ads_oauth_state_nonce_fks.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260825180000_restrict_ads_spend_replacement_to_service_role.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260825191000_revoke_legacy_google_ads_spend_upsert.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      'a191c7045cb7e2efe1a160f0d7656f0cd433feb9a43f00fa48801fd1ffe91ca1 20260826090000_restrict_ads_credential_rpcs_to_service_role.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '08c2b4e066a77294c8f3515a904beac9861e9273c2d7d856e5254d749dfb159a 20260827110001_retire_snapchat_disconnect_spend_rpc.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      'c2b4d82902c24edb2f3d17b001c4646c9db787f92fa28ab0912a279b40f71c65 20260826150000_restrict_ads_connection_select_to_view_permission.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      'd35b075406091766d009071449cd197c15e777f46d778f7d049c7939bf35fa21 20260827100001_google_ads_reauth_missing_refresh.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '97c11c851442c4a12dd5079111d18fbce369a2a34fd3cc7c6be96e849df64938 20260827120001_fence_ads_sync_runs.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      'bff3ca2da014926b884dca64fc6a3a7e28e9f611bce051d0e5380fc719943eed 20260827120100_fence_ads_spend_replacements.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '635152373f9ef17c17dec27eee616fe1ea2235a2a0cf907a40642135419eb5fc 20260827120200_order_ads_sync_run_starts.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '89756694f550c5fb487f51b0267c67e15660e5ea93757bd5cee37f2e74ec8785 20260828010000_server_owned_ads_sync_runs.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      'd983c2da2e003b816a7c21b7cca0fff235956fdc0d6d52a9a120cffad924492d 20260828090000_allow_staff_dashboard_preferences.sql'
    );
    expect(ADS_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '5dad1e7b74d8f6d35b7849584b8241358aeec2a36dbe5882f159128bf246691b 20260828100000_ads_sync_window_completion.sql'
    );
  });
});
