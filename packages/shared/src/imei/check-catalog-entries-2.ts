import { catalogEntry } from './check-catalog-types';

export const IMEI_CHECK_CATALOG_PART_2 = {
  activation: catalogEntry(
    'Apple activation check',
    'Check whether the Apple device has been activated; other history fields depend on the supplier report.',
    'history',
    ['apple'],
    ['smartphone', 'tablet'],
    ['activation']
  ),
  findMy: catalogEntry(
    'Find My / Activation Lock',
    'Check whether Find My or Activation Lock is enabled.',
    'ownership',
    ['apple'],
    ['smartphone', 'tablet'],
    ['icloud']
  ),
  lostMode: catalogEntry(
    'Apple Lost Mode check',
    'Check whether Apple records mark the device as clean or lost.',
    'ownership',
    ['apple'],
    ['smartphone', 'tablet', 'laptop'],
    ['icloudCleanLost', 'icloudPro']
  ),
  management: catalogEntry(
    'Company or school management',
    'Check whether the device has mobile-device-management restrictions.',
    'ownership',
    ['apple'],
    ['smartphone', 'tablet', 'laptop'],
    ['mdm']
  ),
  macSpecificationsLocks: catalogEntry(
    'Mac specifications & account locks',
    'Review advertised Mac specifications, Find My and management status.',
    'reports',
    ['apple'],
    ['laptop'],
    []
  ),
  macSpecifications: catalogEntry(
    'Mac specifications',
    'Identify Mac specifications; custom-to-order configurations are excluded by this supplier.',
    'details',
    ['apple'],
    ['laptop'],
    ['macInfo']
  ),
  macFindMy: catalogEntry(
    'Mac Activation Lock check',
    'Check whether Find My Mac is enabled.',
    'ownership',
    ['apple'],
    ['laptop', 'desktop'],
    ['macIcloud']
  ),
  macOwnershipStatus: catalogEntry(
    'Mac Activation Lock & Lost Mode',
    'Check Find My Mac and clean or lost status together.',
    'ownership',
    ['apple'],
    ['laptop', 'desktop'],
    []
  ),
  appleSalesCaseHistory: catalogEntry(
    'Apple sales & replacement history',
    'Review advertised original sales, support-case and replacement records.',
    'history',
    ['apple'],
    ['smartphone', 'tablet', 'laptop'],
    ['replacementHistory']
  ),
  appleRepairHistory: catalogEntry(
    'Apple sales & repair history',
    'Review advertised sales, support cases, repairs and replacement records.',
    'history',
    ['apple'],
    ['smartphone', 'tablet', 'laptop'],
    ['gsxRepairs']
  ),
  appleCaseHistory: catalogEntry(
    'Apple support & replacement history',
    'Review advertised Apple support-case and replacement records.',
    'history',
    ['apple'],
    ['smartphone', 'tablet', 'laptop'],
    ['gsxPremium']
  ),
  appleDetailedHistory: catalogEntry(
    'Apple detailed history report',
    'Review advertised sales, cases, replacement history, activation and Wi-Fi address records.',
    'reports',
    ['apple'],
    ['smartphone', 'tablet'],
    ['applePremiumMax']
  ),
  appleActivationPolicyHistory: catalogEntry(
    'Apple history & activation policy',
    'Review advertised sales, support cases, replacement records and activation policy.',
    'history',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  applePurchaseDate: catalogEntry(
    'Apple purchase date',
    'Check the purchase date recorded for the device.',
    'history',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  appleWarranty: catalogEntry(
    'Apple warranty check',
    'Check the warranty coverage recorded for the device.',
    'history',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  replacementStatus: catalogEntry(
    'Apple replacement-device status',
    'Check replacement-device records; replaced-unit and active-unit queries retain separate supplier scopes.',
    'history',
    ['apple'],
    ['smartphone', 'tablet'],
    ['replacementStatus']
  ),
  esimCompatibility: catalogEntry(
    'eSIM compatibility check',
    'Check whether the device supports eSIM or physical SIM.',
    'advanced',
    ['all'],
    ['smartphone', 'tablet'],
    ['esimCompatibility']
  ),
  carrierAndSim: catalogEntry(
    'Carrier & SIM-lock check',
    'Check the original carrier and whether the device is SIM-locked.',
    'network',
    ['apple'],
    ['smartphone', 'tablet'],
    ['carrier']
  ),
  simLock: catalogEntry(
    'SIM-lock check',
    'Check whether the iPhone is locked to a carrier.',
    'network',
    ['apple'],
    ['smartphone'],
    ['simLock']
  ),
  samsungDetails: catalogEntry(
    'Samsung details & warranty',
    'Review advertised Samsung model, carrier and warranty details.',
    'details',
    ['samsung'],
    ['smartphone'],
    ['samsung']
  ),
} as const;
