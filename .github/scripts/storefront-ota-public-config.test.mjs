import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preserveTiktokCapability } from './storefront-ota-public-config.mjs';

test('preserves an enabled native TikTok capability without embedding the native secret', () => {
  const config = {
    plugins: ['expo-router'],
    extra: { tiktokBusiness: { isConfigured: false, iosAppStoreId: '123' } },
  };
  const result = preserveTiktokCapability(config, 'true');
  assert.equal(result.extra.tiktokBusiness.isConfigured, true);
  assert.equal(config.extra.tiktokBusiness.isConfigured, false);
  assert.deepEqual(result.plugins, ['expo-router']);
});

test('rejects an unknown native TikTok capability instead of guessing', () => {
  const config = { extra: { tiktokBusiness: { isConfigured: false } } };
  assert.throws(() => preserveTiktokCapability(config, ''), /tiktok/i);
});

test('rejects a config that contains TikTok build-plugin options', () => {
  const config = {
    plugins: [['@baci/tiktok-business/plugin', { appSecret: 'private' }]],
    extra: { tiktokBusiness: { isConfigured: true } },
  };
  assert.throws(() => preserveTiktokCapability(config, 'true'), /plugin/i);
});
