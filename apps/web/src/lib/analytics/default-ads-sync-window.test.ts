import { describe, expect, it } from 'vitest';
import {
  buildAdsSyncWindowChunks,
  buildDefaultAdsSyncWindow,
} from './default-ads-sync-window';

describe('buildDefaultAdsSyncWindow', () => {
  it('preserves local calendar dates near a positive-offset midnight boundary', () => {
    expect(buildDefaultAdsSyncWindow(new Date(2026, 7, 21, 0, 30))).toEqual({
      endDate: '2026-08-21',
      startDate: '2026-07-22',
    });
  });

  it('chunks a Meta range at the provider 31-day boundary', () => {
    expect(
      buildAdsSyncWindowChunks(
        { endDate: '2026-02-15', startDate: '2026-01-01' },
        'meta_ads'
      )
    ).toEqual([
      { endDate: '2026-01-31', startDate: '2026-01-01' },
      { endDate: '2026-02-15', startDate: '2026-02-01' },
    ]);
  });

  it('keeps a Google range at or below 90 days per request', () => {
    const chunks = buildAdsSyncWindowChunks(
      { endDate: '2026-05-01', startDate: '2026-01-01' },
      'google_ads'
    );
    expect(chunks).toEqual([
      { endDate: '2026-03-31', startDate: '2026-01-01' },
      { endDate: '2026-05-01', startDate: '2026-04-01' },
    ]);
  });

  it('chunks TikTok daily reports at the provider 30-day boundary', () => {
    expect(
      buildAdsSyncWindowChunks(
        { endDate: '2026-02-01', startDate: '2026-01-01' },
        'tiktok_ads'
      )
    ).toEqual([
      { endDate: '2026-01-30', startDate: '2026-01-01' },
      { endDate: '2026-02-01', startDate: '2026-01-31' },
    ]);
  });

  it('allows the Snapchat 366-day maximum before chunking', () => {
    const oneYear = buildAdsSyncWindowChunks(
      { endDate: '2027-01-01', startDate: '2026-01-01' },
      'snapchat_ads'
    );
    const overOneYear = buildAdsSyncWindowChunks(
      { endDate: '2027-01-02', startDate: '2026-01-01' },
      'snapchat_ads'
    );

    expect(oneYear).toHaveLength(1);
    expect(overOneYear).toHaveLength(2);
    expect(overOneYear[0]).toEqual({
      endDate: '2027-01-01',
      startDate: '2026-01-01',
    });
    expect(overOneYear[1]).toEqual({
      endDate: '2027-01-02',
      startDate: '2027-01-02',
    });
  });

  it('leaves a provider-safe range as one request', () => {
    expect(
      buildAdsSyncWindowChunks(
        { endDate: '2026-08-21', startDate: '2026-08-01' },
        'meta_ads'
      )
    ).toEqual([{ endDate: '2026-08-21', startDate: '2026-08-01' }]);
  });
});
