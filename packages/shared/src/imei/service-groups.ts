import type { ImeiServiceTierKey } from './service-tiers';

const SERVICE_GOALS = [
  {
    id: 'details',
    label: 'Device details',
    tiers: [
      'basic',
      'appleBasic',
      'serialInfo',
      'samsung',
      'samsungPro',
      'pixel',
      'oppoRealme',
      'transsion',
      'oneplusPremium',
      'transsionPremium',
      'macInfo',
      'macPhotoReport',
    ],
  },
  {
    id: 'blacklist',
    label: 'Lost or stolen check',
    tiers: ['blacklist', 'blacklistPro'],
  },
  {
    id: 'network',
    label: 'Network lock check',
    tiers: ['carrier', 'simLock', 'carrierFmi'],
  },
  {
    id: 'ownership',
    label: 'Ownership & account locks',
    tiers: [
      'icloud',
      'icloudPro',
      'icloudCleanLost',
      'macIcloud',
      'mdm',
      'miLock',
      'miLostPro',
    ],
  },
  {
    id: 'history',
    label: 'Warranty & device history',
    tiers: [
      'activation',
      'soldByCountry',
      'gsxPremium',
      'gsxRepairs',
      'repairEligibility',
      'replacementHistory',
      'replacementStatus',
      'refurbishedStatus',
      'demoUnit',
      'samsungSoldBy',
    ],
  },
  {
    id: 'finance',
    label: 'Finance & restrictions',
    tiers: [
      'knoxGuard',
      'knoxEnrollment',
      'attFinance',
      'tmobileFinance',
      'verizonFinance',
      'tracfoneFinance',
      'xfinityFinance',
      'japanDocomo',
      'japanSoftbank',
      'japanKddi',
      'japanRakuten',
      'japanNetwork',
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced details',
    tiers: ['esimCompatibility', 'applePartNumber'],
  },
  {
    id: 'reports',
    label: 'Combined reports',
    tiers: ['full', 'applePremium', 'applePremiumMax'],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  tiers: readonly ImeiServiceTierKey[];
}[];

export type ImeiServiceGoalId = (typeof SERVICE_GOALS)[number]['id'];
export const IMEI_SERVICE_GOALS = SERVICE_GOALS.map(({ id, label }) => ({
  id,
  label,
}));

export interface ImeiServiceGroup {
  id: string;
  label: string;
  tierKeys: ImeiServiceTierKey[];
}

/** Operates only on caller-filtered, purchasable tiers; never adds supplier variants. */
export function groupImeiServices(
  keys: readonly ImeiServiceTierKey[],
  selected: ImeiServiceTierKey
): ImeiServiceGroup[] {
  const remaining = new Set(keys);
  return SERVICE_GOALS.flatMap((goal) => {
    const tiers = goal.tiers.filter((key) => remaining.has(key));
    if (!tiers.length) return [];
    const tierKeys: ImeiServiceTierKey[] = tiers.some((key) => key === selected)
      ? [selected, ...tiers.filter((key) => key !== selected)]
      : [...tiers];
    for (const key of tierKeys) remaining.delete(key);
    return [{ id: goal.id, label: goal.label, tierKeys }];
  });
}
