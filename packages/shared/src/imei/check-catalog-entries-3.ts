import { catalogEntry } from './check-catalog-types';

export const IMEI_CHECK_CATALOG_PART_3 = {
  samsungSalesWarranty: catalogEntry(
    'Samsung sales country & warranty',
    'Review advertised Samsung sales country, sale date, carrier and warranty details.',
    'history',
    ['samsung'],
    ['smartphone'],
    ['samsungSoldBy']
  ),
  knoxGuard: catalogEntry(
    'Samsung finance-lock status',
    'Check whether Samsung Knox Guard reports the device locked or unlocked.',
    'finance',
    ['samsung'],
    ['smartphone'],
    ['knoxGuard']
  ),
  knoxGuardEnrollment: catalogEntry(
    'Samsung Knox Guard enrollment',
    'Check Knox Guard enrollment; this is separate from Knox Mobile Enrollment or MDM.',
    'finance',
    ['samsung'],
    ['smartphone'],
    []
  ),
  pixelDetails: catalogEntry(
    'Google Pixel details',
    'Identify the Google Pixel device information available from its IMEI.',
    'details',
    ['google'],
    ['smartphone'],
    ['pixel']
  ),
  honorWarrantyNetwork: catalogEntry(
    'Honor warranty & carrier',
    'Review advertised Honor carrier and warranty information.',
    'history',
    ['honor'],
    ['smartphone'],
    []
  ),
  honorDetails: catalogEntry(
    'Honor device details',
    'Identify the Honor device information available from its IMEI.',
    'details',
    ['honor'],
    ['smartphone'],
    []
  ),
  huaweiIdentifier: catalogEntry(
    'Huawei serial & IMEI lookup',
    'Look up Huawei identity information and related identifiers.',
    'advanced',
    ['huawei'],
    ['smartphone'],
    []
  ),
  huaweiWarranty: catalogEntry(
    'Huawei device details & warranty',
    'Review advertised Huawei device details and warranty; carrier coverage varies by supplier.',
    'details',
    ['huawei'],
    ['smartphone'],
    []
  ),
  transsionWarranty: catalogEntry(
    'Tecno, Infinix or itel warranty',
    'Review advertised activation date and warranty information.',
    'history',
    ['tecno', 'infinix', 'itel'],
    ['smartphone'],
    ['transsionPremium']
  ),
  kddiDeviceStatus: catalogEntry(
    'Japan au KDDI device status',
    'Check the device status reported for Japan au KDDI; this is separate from finance status.',
    'finance',
    ['all'],
    ['smartphone'],
    []
  ),
  kddiFinance: catalogEntry(
    'Japan au KDDI finance status',
    'Check the finance status advertised for Japan au KDDI.',
    'finance',
    ['all'],
    ['smartphone'],
    ['japanKddi']
  ),
  docomoFinance: catalogEntry(
    'Japan NTT Docomo finance status',
    'Check the finance status advertised for Japan NTT Docomo.',
    'finance',
    ['all'],
    ['smartphone'],
    ['japanDocomo']
  ),
  softbankFinance: catalogEntry(
    'Japan SoftBank finance status',
    'Check the finance status advertised for Japan SoftBank.',
    'finance',
    ['all'],
    ['smartphone'],
    ['japanSoftbank']
  ),
  lenovoMobileWarranty: catalogEntry(
    'Lenovo mobile device warranty',
    'Review advertised Lenovo mobile-device details and warranty.',
    'history',
    ['lenovo'],
    ['smartphone'],
    []
  ),
  lgDetails: catalogEntry(
    'LG device details',
    'Identify the LG device information available from its IMEI or serial.',
    'details',
    ['lg'],
    ['smartphone'],
    []
  ),
  oneplusDetails: catalogEntry(
    'OnePlus device details',
    'Identify the OnePlus device information available from its IMEI.',
    'details',
    ['oneplus'],
    ['smartphone'],
    ['oneplusPremium']
  ),
  oppoWarranty: catalogEntry(
    'OPPO model & warranty',
    'Review advertised OPPO model and warranty information.',
    'history',
    ['oppo'],
    ['smartphone'],
    []
  ),
  oppoFamilyDetails: catalogEntry(
    'OPPO, OnePlus or Realme details',
    'Review advertised device details for OPPO, OnePlus or Realme.',
    'details',
    ['oppo', 'oneplus', 'realme'],
    ['smartphone'],
    ['oppoRealme']
  ),
  tracfoneStatus: catalogEntry(
    'TracFone or Straight Talk status',
    'Check the advertised TracFone or Straight Talk device status.',
    'finance',
    ['all'],
    ['smartphone'],
    ['tracfoneFinance']
  ),
  tmobileStatus: catalogEntry(
    'T-Mobile USA device status',
    'Check advertised clean, lost, stolen, blocked and unpaid status for T-Mobile USA.',
    'finance',
    ['all'],
    ['smartphone'],
    ['tmobileFinance']
  ),
} as const;
