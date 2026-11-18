import type { ImeiReport } from '@baci/shared/imei';

/** A completed SIM-lock report on a smartphone, as history returns it. */
export const report: ImeiReport = {
  lookupId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-31T00:00:00Z',
  tier: 'simLock',
  device: 'smartphone',
  result: {
    imei: '490154203237518',
    device: 'iPhone 13',
    modelNumber: '',
    status: 'Unknown',
    icloud: 'Unknown',
    icloudLock: 'Unknown',
    simLock: 'Unlocked',
    blacklistStatus: 'Unknown',
    carrier: 'Unknown',
    deviceImage: '',
    score: 50,
    deviceType: 'apple',
    verdict: 'Not checked',
    verdictType: 'caution',
  },
};
