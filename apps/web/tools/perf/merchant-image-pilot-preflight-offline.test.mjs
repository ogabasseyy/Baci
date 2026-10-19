import { describe, expect, it } from 'vitest';
import { runOfflinePreflight } from './merchant-image-pilot-preflight-offline.mjs';
import {
  offlineOptions,
  setupOffline,
} from './merchant-image-pilot-preflight-offline-fixtures.mjs';

describe('merchant-image-pilot-preflight-offline', () => {
  it('passes on a clean offline fixture and populates accepted bindings and stagedHashes', async () => {
    const fixture = await setupOffline();
    const report = await runOfflinePreflight(offlineOptions(fixture));
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.accepted).toHaveLength(1);
    expect(report.accepted[0].assetId).toBe('logo-a');
    expect(
      Object.keys(report.stagedHashes).some((key) =>
        key.startsWith('/__pilot/originals/')
      )
    ).toBe(true);
  });

  it('fails closed when caller recipe mismatches the pinned recipe', async () => {
    const fixture = await setupOffline();
    const report = await runOfflinePreflight(
      offlineOptions(fixture, { recipe: 'pilot/wrong' })
    );
    expect(report.ok).toBe(false);
    expect(report.failures[0]).toMatch(/recipe-pin: caller recipe/);
  });
});
