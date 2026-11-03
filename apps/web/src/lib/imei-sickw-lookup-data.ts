import type { ImeiCheckResult } from '@/app/api/storefront/imei-check/sickw-parser.types';

/** Preserve provider scores including zero when completing a successful lookup. */
export function buildSickwLookupData(
  imei: string,
  parsed: Partial<ImeiCheckResult>,
  payload: unknown
): ImeiCheckResult {
  const device = parsed.device || '';
  return {
    imei,
    device: device || 'Unknown Device',
    modelNumber: parsed.modelNumber || '',
    status: parsed.status || 'Unknown',
    icloud: parsed.icloud || 'Unknown',
    icloudLock: parsed.icloudLock || 'Unknown',
    simLock: parsed.simLock || 'Unknown',
    blacklistStatus: parsed.blacklistStatus || 'Unknown',
    carrier: parsed.carrier || 'Unknown',
    deviceImage: '',
    deviceProfile: parsed.deviceProfile,
    score: parsed.score ?? 50,
    activationStatus: parsed.activationStatus,
    serialNumber: parsed.serialNumber,
    purchaseDate: parsed.purchaseDate,
    purchaseCountry: parsed.purchaseCountry,
    warranty: parsed.warranty,
    refurbished: parsed.refurbished,
    demoUnit: parsed.demoUnit,
    mdmStatus: parsed.mdmStatus,
    knoxGuardStatus: parsed.knoxGuardStatus,
    miLockStatus: parsed.miLockStatus,
    miLostStatus: parsed.miLostStatus,
    partNumber: parsed.partNumber,
    repairEligibility: parsed.repairEligibility,
    gsxCoverage: parsed.gsxCoverage,
    repairHistory: parsed.repairHistory,
    replacementHistory: parsed.replacementHistory,
    esimCompatibility: parsed.esimCompatibility,
    financeStatus: parsed.financeStatus,
    knoxEnrollment: parsed.knoxEnrollment,
    soldBy: parsed.soldBy,
    wifiMac: parsed.wifiMac,
    devicePhoto: parsed.devicePhoto,
    deviceType: parsed.deviceType || 'other',
    verdict: parsed.verdict || 'Unable to determine device status.',
    verdictType: parsed.verdictType || 'caution',
    rawResponse:
      process.env.NODE_ENV === 'development'
        ? JSON.stringify(payload)
        : undefined,
  };
}
