import { mappedCheck } from './types';

export const PETROCK_CHECK_MAP_PART_1 = [
  mappedCheck('1940', 'deviceModel', 0.04, 'IMEI', ['imei'], {
    supplierName: 'Device Model | Brand | Manufacturer Check [By IMEI]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('690', 'deviceModel', 0.05, 'IMEI', ['imei'], {
    supplierName: 'iPhone | Generic Model Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck(
    '1942',
    'appleIdentifierValidation',
    0.04,
    'IMEI',
    ['imei', 'serial'],
    {
      supplierName: 'Apple IMEI | Serial Number Validator Check',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck('1953', 'appleModel', 0.05, 'IMEI', ['imei'], {
    deviceScope: ['smartphone', 'tablet'],
    supplierName: 'Apple Model | Product Description Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1954', 'appleConfiguration', 0.05, 'IMEI', ['imei', 'serial'], {
    evidence: 'successful_probe',
    observedFields: ['device', 'color', 'storage', 'icloud'],
    notes: [
      'Successful 2026-10-25 iPhone IMEI probe only; serial and other-device coverage remain unverified. No blacklist or provider device photo was returned.',
    ],
    supplierName: 'Apple Model | Color | Storage | FMI Check By IMEI | SN',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('674', 'appleConfiguration', 0.06, 'IMEI', ['imei'], {
    deviceScope: ['smartphone', 'tablet'],
    supplierName: 'Apple Model | Color | Capacity Check By IMEI [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('675', 'appleConfiguration', 0.06, 'Serial Number', ['serial'], {
    supplierName: 'Apple Model | Color | Capacity Check By SN [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('1956', 'eidLookup', 0.05, 'IMEI', ['imei'], {
    brandScope: ['apple', 'samsung', 'google'],
    notes: ['EID is a returned identifier, not proof of eSIM compatibility.'],
    supplierName: 'Apple | Samsung | Google Pixel EID Number Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1963', 'applePartNumber', 0.12, 'IMEI', ['imei', 'serial'], {
    supplierName: 'Apple Part Number | MPN Check',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('724', 'hpPcIdentity', 0.04, 'IMEI', ['pc-serial'], {
    supplierName: 'HP PC Model Check',
    turnaround: '1 Minutes',
    inputType: 'text',
  }),
  mappedCheck('735', 'lenovoPcIdentity', 0.07, 'Serial Number', ['pc-serial'], {
    supplierName: 'Lenovo PC Model Check',
    turnaround: '1 Minutes',
    inputType: 'text',
  }),
  mappedCheck('2014', 'dellPcIdentity', 0.04, 'IMEI', ['pc-serial'], {
    supplierName: 'Dell Laptop Model Check',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('665', 'meidConversion', 0.07, 'MEID', ['meid'], {
    notes: [
      'Requires MEID input. Existing IMEI/serial entry forms cannot submit this contract.',
    ],
    supplierName: 'Apple Convert MEID To IMEI [Instant]',
    turnaround: '1 Minutes',
    inputType: 'text',
  }),
  mappedCheck(
    '686',
    'appleIdentifierConversion',
    0.04,
    'IMEI or Serial Number',
    ['imei', 'serial'],
    {
      deviceScope: ['smartphone'],
      supplierName:
        'Convert iPhone IMEI1 or IMEI1 to SN | SN to IMEI1 or IMEI2',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck('1968', 'secondaryIdentifier', 0.04, 'IMEI', ['imei'], {
    supplierName: 'Convert IMEI to IMEI2 | Serial Number [No Model]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
] as const;
