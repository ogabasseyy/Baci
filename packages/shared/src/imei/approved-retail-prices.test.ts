import { expect, it } from 'vitest';
import {
  IMEI_SERVICE_TIERS,
  PETROCK_DARK_IMEI_SERVICE_TIERS,
  PUBLIC_IMEI_SERVICE_TIERS,
} from './service-tiers';

it('applies only the 25 approved reductions and retains the protected retail prices', () => {
  expect(
    Object.fromEntries(
      PUBLIC_IMEI_SERVICE_TIERS.map((key) => [
        key,
        IMEI_SERVICE_TIERS[key].price,
      ])
    )
  ).toEqual({
    applePartNumber: 700,
    simLock: 500,
    serialInfo: 200,
    appleBasic: 500,
    demoUnit: 1900,
    icloud: 300,
    full: 1000,
    gsxPremium: 6300,
    knoxGuard: 2900,
    mdm: 2900,
    macIcloud: 1900,
    miLock: 1000,
    miLostPro: 4800,
    carrierFmi: 800,
    carrier: 600,
    activation: 400,
    oppoRealme: 1900,
    pixel: 1200,
    basic: 300,
    repairEligibility: 1400,
    gsxRepairs: 3800,
    replacementHistory: 6700,
    samsung: 600,
    samsungPro: 1000,
    soldByCountry: 5700,
    blacklist: 700,
    blacklistPro: 1200,
    transsion: 300,
    esimCompatibility: 400,
    icloudCleanLost: 300,
    icloudPro: 2100,
  });
});

it('keeps the 20 unverified Petrock candidates disabled with unchanged prices', () => {
  expect(PETROCK_DARK_IMEI_SERVICE_TIERS).toHaveLength(20);
  for (const key of PETROCK_DARK_IMEI_SERVICE_TIERS) {
    expect(PUBLIC_IMEI_SERVICE_TIERS as readonly string[]).not.toContain(key);
  }
  expect(
    Object.fromEntries(
      PETROCK_DARK_IMEI_SERVICE_TIERS.map((key) => [
        key,
        IMEI_SERVICE_TIERS[key].price,
      ])
    )
  ).toEqual({
    attFinance: 1500,
    applePremiumMax: 14700,
    applePremium: 7900,
    japanNetwork: 1500,
    japanKddi: 1500,
    knoxEnrollment: 1000,
    macInfo: 5000,
    macPhotoReport: 9100,
    japanDocomo: 1500,
    oneplusPremium: 700,
    japanRakuten: 1500,
    refurbishedStatus: 700,
    replacementStatus: 700,
    samsungSoldBy: 700,
    japanSoftbank: 1500,
    tmobileFinance: 700,
    transsionPremium: 700,
    tracfoneFinance: 700,
    verizonFinance: 700,
    xfinityFinance: 700,
  });
});
