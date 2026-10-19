import type { BillType } from './vtu';

/**
 * Maps VTU purchase types to commission category codes. Lives here
 * (not vtu.ts) to keep that schema module under the 300-line budget.
 */
export const COMMISSION_CATEGORY_MAP: Record<BillType, string> = {
  airtime: 'AIRTIME',
  data: 'DATA',
  electricity: 'ELECTRICITY',
  cable_tv: 'CABLE',
  betting: 'BETTING',
};
