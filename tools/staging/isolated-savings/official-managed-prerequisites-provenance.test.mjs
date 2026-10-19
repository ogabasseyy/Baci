import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyOfficialManagedProvenance } from './official-managed-prerequisites-provenance.mjs';

test('rejects unavailable, redirected and altered sources without executing SQL', async () => {
  for (const response of [
    { ok: false },
    { ok: true, redirected: true },
    {
      ok: true,
      redirected: false,
      text: async () => 'tampered official source',
    },
  ]) {
    await assert.rejects(
      verifyOfficialManagedProvenance((url, options) => {
        assert.match(url, /^https:\/\/raw.githubusercontent.com\/supabase\//);
        assert.equal(options.redirect, 'error');
        return Promise.resolve(response);
      })
    );
  }
});
