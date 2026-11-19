import { catalogEntry } from './check-catalog-types';

export const IMEI_CHECK_CATALOG_PART_1 = {
  deviceModel: catalogEntry(
    'Device model check',
    'Identify the device brand and model.',
    'details',
    ['all'],
    ['smartphone'],
    ['basic']
  ),
  appleIdentifierValidation: catalogEntry(
    'Apple identifier check',
    'Check whether an Apple IMEI or serial number is valid.',
    'advanced',
    ['apple'],
    ['smartphone', 'tablet', 'laptop', 'watch'],
    []
  ),
  appleModel: catalogEntry(
    'Apple model details',
    'Identify the Apple model and product description.',
    'details',
    ['apple'],
    ['smartphone', 'tablet'],
    ['appleBasic']
  ),
  appleConfiguration: catalogEntry(
    'Apple model, colour & storage',
    'Identify the Apple model, colour and storage capacity.',
    'details',
    ['apple'],
    ['smartphone', 'tablet', 'laptop'],
    []
  ),
  eidLookup: catalogEntry(
    'eSIM device identifier',
    'Retrieve the device EID used for eSIM identification; this does not confirm eSIM compatibility.',
    'advanced',
    ['apple', 'samsung', 'google'],
    ['smartphone', 'tablet'],
    []
  ),
  applePartNumber: catalogEntry(
    'Apple part number',
    'Find the Apple part number that identifies the device variant.',
    'advanced',
    ['apple'],
    ['smartphone', 'tablet', 'laptop', 'watch'],
    ['applePartNumber']
  ),
  hpPcIdentity: catalogEntry(
    'HP computer model',
    'Identify an HP computer from its serial number.',
    'details',
    ['hp'],
    ['laptop', 'desktop'],
    []
  ),
  lenovoPcIdentity: catalogEntry(
    'Lenovo computer model',
    'Identify a Lenovo computer from its serial number.',
    'details',
    ['lenovo'],
    ['laptop', 'desktop'],
    []
  ),
  dellPcIdentity: catalogEntry(
    'Dell computer model',
    'Identify a Dell computer from its serial number or service tag.',
    'details',
    ['dell'],
    ['laptop'],
    []
  ),
  meidConversion: catalogEntry(
    'Convert MEID to IMEI',
    'Convert a MEID identifier into an IMEI.',
    'advanced',
    ['apple'],
    ['smartphone'],
    []
  ),
  appleIdentifierConversion: catalogEntry(
    'Apple IMEI and serial lookup',
    'Find related Apple IMEI or serial identifiers.',
    'advanced',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  secondaryIdentifier: catalogEntry(
    'Second IMEI or serial lookup',
    'Find a related IMEI or serial number; device model is not included.',
    'advanced',
    ['all'],
    ['smartphone'],
    []
  ),
  appleOwnershipReport: catalogEntry(
    'Apple ownership report',
    'Review advertised warranty, network, blacklist, Find My and management coverage together.',
    'reports',
    ['apple'],
    ['smartphone', 'tablet'],
    ['applePremium']
  ),
  appleResaleReport: catalogEntry(
    'Apple resale-history report',
    'Review advertised carrier, blacklist, replacement and refurbishment records.',
    'reports',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  appleUsOwnershipReport: catalogEntry(
    'Apple warranty & US blacklist report',
    'Review advertised warranty, carrier, Find My and US blacklist coverage.',
    'reports',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  appleWarrantyNetworkReport: catalogEntry(
    'Apple warranty & network report',
    'Review advertised warranty, carrier, country and SIM-lock information.',
    'reports',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  appleNetworkFindMyReport: catalogEntry(
    'Apple network, warranty & Find My',
    'Review advertised carrier, warranty and Find My information together.',
    'reports',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  appleLockReport: catalogEntry(
    'Apple account, SIM & management locks',
    'Review advertised Find My, SIM-lock and device-management status together.',
    'reports',
    ['apple'],
    ['smartphone', 'tablet'],
    []
  ),
  blacklist: catalogEntry(
    'Lost or stolen check',
    'Check the advertised lost or stolen blacklist records for this device.',
    'blacklist',
    ['all'],
    ['smartphone'],
    ['blacklist', 'blacklistPro']
  ),
  tmobileBlacklistHistory: catalogEntry(
    'T-Mobile blacklist history',
    'Check T-Mobile USA blacklist status and history.',
    'blacklist',
    ['all'],
    ['smartphone'],
    []
  ),
} as const;
