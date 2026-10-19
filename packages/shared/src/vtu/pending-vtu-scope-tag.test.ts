import { describe, expect, it } from 'vitest';
import { buildPendingVtuScopeTag } from './pending-vtu-scope-tag';
import { isVtuScopeHash } from './vtu-scope-hash';

describe('buildPendingVtuScopeTag', () => {
  it('tags owner+merchant deterministically, null-normalized', () => {
    // Codex R62 6rtokd: the settle filter recomputes this from the
    // active account, so equal scopes must tag equally and any
    // difference (or null-vs-value) must tag differently.
    const tag = buildPendingVtuScopeTag('owner-a', 'merchant-1');
    expect(tag).toBe(buildPendingVtuScopeTag('owner-a', 'merchant-1'));
    expect(tag).not.toBe(buildPendingVtuScopeTag('owner-b', 'merchant-1'));
    expect(tag).not.toBe(buildPendingVtuScopeTag('owner-a', 'merchant-2'));
    expect(buildPendingVtuScopeTag(null, undefined)).toBe(
      buildPendingVtuScopeTag(undefined, null)
    );
    expect(isVtuScopeHash(tag)).toBe(true);
  });
});
