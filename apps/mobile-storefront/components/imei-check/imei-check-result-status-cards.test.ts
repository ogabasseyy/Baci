import { IMEI_SERVICE_TIERS, type ImeiCheckField } from '@baci/shared/imei';
import { describe, expect, it } from '@jest/globals';
import type { ImeiResult } from '@/lib/validation';
import { getImeiResultStatusCards } from './imei-check-result-status-cards';

const baseResult: ImeiResult = {
  imei: '490154203237518',
  device: 'Xiaomi 14',
  modelNumber: '23127PN0CC',
  status: 'Clean',
  icloud: 'Unknown',
  icloudLock: 'Unknown',
  simLock: 'Unlocked',
  blacklistStatus: 'Not Blacklisted',
  carrier: 'Unlocked',
  deviceImage: '',
  score: 94,
  deviceType: 'android',
  verdict: 'Safe to buy',
  verdictType: 'safe',
};

const CORE_CHECKS: readonly ImeiCheckField[] = [
  'blacklistStatus',
  'icloud',
  'simLock',
  'carrier',
];

describe('getImeiResultStatusCards', () => {
  it('includes the core status cards the tier actually checks', () => {
    const cards = getImeiResultStatusCards(baseResult, CORE_CHECKS);

    expect(cards.map((card) => card.label)).toEqual([
      'Blacklist Status',
      'iCloud Status',
      'Find My iPhone',
      'SIM Lock',
      'Carrier',
    ]);
  });

  it('omits core cards the tier never checked (no wall of Unknown)', () => {
    // A serial-info report checks device/model/serial only — it must not
    // render Unknown blacklist/iCloud/FMI/SIM/carrier cards it never ran.
    const cards = getImeiResultStatusCards(
      { ...baseResult, serialNumber: 'C02XK1ZLJGH5' },
      IMEI_SERVICE_TIERS.serialInfo.checksIncluded
    );
    const labels = cards.map((card) => card.label);

    expect(labels).toEqual(['Serial Number']);
  });

  it('shows iCloud status separately from Find My lock status', () => {
    const cards = getImeiResultStatusCards(
      {
        ...baseResult,
        icloud: 'Lost',
        icloudLock: 'Unknown',
      },
      CORE_CHECKS
    );

    expect(cards.find((card) => card.label === 'iCloud Status')).toMatchObject({
      cleanAware: true,
      value: 'Lost',
    });
    expect(cards.find((card) => card.label === 'Find My iPhone')).toMatchObject(
      {
        cleanAware: true,
        value: 'Unknown',
      }
    );
  });

  it('includes extended and Xiaomi fields when present', () => {
    const cards = getImeiResultStatusCards(
      {
        ...baseResult,
        activationStatus: 'Activated',
        serialNumber: 'F2LDN12345',
        purchaseDate: '2025-09-22',
        purchaseCountry: 'Nigeria',
        warranty: 'Limited Warranty',
        refurbished: 'No',
        demoUnit: 'No',
        mdmStatus: 'OFF',
        miLockStatus: 'Locked',
        miLostStatus: 'Clean',
      },
      CORE_CHECKS
    );

    expect(cards.map((card) => card.label)).toEqual(
      expect.arrayContaining([
        'Activation Status',
        'Serial Number',
        'Purchase Date',
        'Purchase Country',
        'Warranty',
        'Refurbished',
        'Demo Unit',
        'MDM Status',
        'Mi Lock Status',
        'Mi Lost Status',
      ])
    );
  });

  it('omits optional status cards when provider fields are absent', () => {
    const cards = getImeiResultStatusCards(baseResult, CORE_CHECKS);
    const labels = cards.map((card) => card.label);

    expect(labels).not.toEqual(
      expect.arrayContaining([
        'Activation Status',
        'Serial Number',
        'MDM Status',
        'Mi Lock Status',
        'Mi Lost Status',
      ])
    );
  });

  it('omits optional status cards when provider fields are empty strings', () => {
    const cards = getImeiResultStatusCards(
      {
        ...baseResult,
        activationStatus: '',
        mdmStatus: '',
        serialNumber: '',
      },
      CORE_CHECKS
    );
    const labels = cards.map((card) => card.label);

    expect(labels).not.toEqual(
      expect.arrayContaining([
        'Activation Status',
        'Serial Number',
        'MDM Status',
      ])
    );
  });

  it('gives facts no colour of their own: the list colours by meaning', () => {
    const cards = getImeiResultStatusCards(
      { ...baseResult, warranty: 'Out Of Warranty' },
      CORE_CHECKS
    );

    for (const card of cards) expect(card).not.toHaveProperty('tint');
    expect(cards.find((card) => card.label === 'Warranty')).toMatchObject({
      value: 'Out Of Warranty',
    });
  });

  it('renders all six optional Phase 3 result fields', () => {
    const cards = getImeiResultStatusCards(
      {
        ...baseResult,
        devicePhoto: 'https://cdn.example.com/device.jpg',
        esimCompatibility: 'Supported',
        financeStatus: 'Past Due',
        knoxEnrollment: 'Enrolled',
        soldBy: 'Example Retailer',
        wifiMac: 'A1:B2:C3:D4:E5:F6',
      },
      ['device']
    );

    expect(cards.map((card) => card.label)).toEqual(
      expect.arrayContaining([
        'eSIM Compatibility',
        'Finance Status',
        'Knox Enrollment',
        'Sold By',
        'Wi-Fi MAC',
        'Device Photo',
      ])
    );
  });
});
