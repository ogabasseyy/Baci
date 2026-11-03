import { mappedCheck } from './types';

export const PETROCK_CHECK_MAP_PART_2 = [
  mappedCheck(
    '666',
    'appleOwnershipReport',
    0.74,
    'IMEI OR SN',
    ['imei', 'serial'],
    {
      supplierName:
        'Apple Identification Pro Report Check [Warranty | Carrier | GSMA | iCloud Status | MDM] With Photo',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck(
    '667',
    'appleResaleReport',
    0.22,
    'IMEI OR SN',
    ['imei', 'serial'],
    {
      supplierName:
        'Apple Identification Report Check Carrier [Blacklist | Replacement | Refurbish Check]',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck(
    '687',
    'appleUsOwnershipReport',
    0.08,
    'IMEI/SN:',
    ['imei', 'serial'],
    {
      supplierName:
        'iPhone & iPad Carrier | Full Warranty | FMI | US Blacklist Check By IMEI | SN [Source 1]',
      turnaround: '1 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck('695', 'appleWarrantyNetworkReport', 0.12, 'IMEI', ['imei'], {
    supplierName:
      'iPhone | iPad Info | Warranty | Coverage | Carrier | Country | SIM Lock Status Check [Source 3]',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('696', 'appleNetworkFindMyReport', 0.09, 'IMEI', ['imei'], {
    deviceScope: ['smartphone'],
    supplierName: 'iPhone Full Carrier Check | Warranty | FMI Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck(
    '3457',
    'appleLockReport',
    0.3,
    'IMEI/SERIAL',
    ['imei', 'serial'],
    {
      supplierName: 'Apple MDM | ICloud | SimLock Check By IMEI/SN',
      turnaround: '1-5 Minutes',
      inputType: 'text_bulk',
    }
  ),
  mappedCheck('662', 'blacklist', 0.05, 'IMEI', ['imei'], {
    supplierName: 'Apple & Generic GSMA Status Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('684', 'blacklist', 0.05, 'IMEI', ['imei'], {
    brandScope: ['apple'],
    notes: [
      'Apple-only worldwide blacklist variant; not a generic-brand substitute.',
    ],
    supplierName: 'Apple Worldwide Block & Blacklist Checker [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('750', 'blacklist', 0.05, 'IMEI', ['imei'], {
    supplierName: 'WorldWide GSMA Blacklisted Check By IMEI [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1955', 'blacklist', 0.04, 'IMEI', ['imei'], {
    evidence: 'rejected_probe',
    notes: [
      '2026-10-25 probe rejected: Unable to check blacklist status. Refund observed. Do not automatically select this as a working default.',
    ],
    supplierName: 'Apple & Generic GSMA Blacklist Status Check [By IMEI]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('701', 'tmobileBlacklistHistory', 0.07, 'IMEI', ['imei'], {
    supplierName:
      'T-Mobile USA Apple | Generic Pro [Blacklist Status & History] Check',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('691', 'activation', 0.05, 'Serial Number', ['serial'], {
    supplierName: 'iPhone | iPad Activation Check By SN [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('692', 'activation', 0.07, 'IMEI', ['imei'], {
    supplierName: 'iPhone | iPad Activation Check IMEI [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('702', 'findMy', 0.05, 'IMEI', ['imei'], {
    deviceScope: ['smartphone'],
    supplierName:
      'Apple Find My iPhone | Activation Lock Check By IMEI [Instant]',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('703', 'findMy', 0.07, 'Serial Number', ['serial'], {
    deviceScope: ['smartphone'],
    notes: [
      'Advertised for 12-character serial numbers; do not route a 10-character serial here.',
    ],
    supplierName:
      'Apple Find My iPhone | Activation Lock Status Check By SN [12 Characters]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
    serialLengths: [12],
  }),
] as const;
