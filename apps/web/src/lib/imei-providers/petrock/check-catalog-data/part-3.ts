import { mappedCheck } from './types';

export const PETROCK_CHECK_MAP_PART_3 = [
  mappedCheck('712', 'findMy', 0.05, 'Serial Number', ['serial'], {
    notes: [
      'Advertises support for 10-character serials; do not infer other formats from the field maximum.',
    ],
    supplierName:
      'iPhone | iPad iCloud Status Check By SN [10 Digits SN Supported]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('706', 'lostMode', 0.07, 'IMEI/Serial No', ['imei', 'serial'], {
    supplierName: 'Apple iCloud Lost | Clean Checker By IMEI|SN [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('670', 'management', 0.3, 'Serial Number', ['serial'], {
    supplierName: 'Apple iOS & MacOS MDM Lock Check By SN',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('671', 'management', 0.3, 'IMEI', ['imei'], {
    deviceScope: ['smartphone', 'tablet'],
    supplierName: 'Apple iOS MDM Lock Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck(
    '707',
    'management',
    0.3,
    'IMEI or Serial Number',
    ['imei', 'serial'],
    {
      supplierName:
        'Apple iPhones | iPads | MacBook MDM Status Check By IMEI | SN',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck('1994', 'management', 0.3, 'IMEI', ['imei'], {
    deviceScope: ['smartphone', 'tablet'],
    supplierName: 'Apple MDM Status Check [By IMEI]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('697', 'macSpecificationsLocks', 0.83, 'IMEI', ['serial'], {
    notes: [
      'Serial input is posted using machine key IMEI. Specifications and lock bundle; no photos promised.',
    ],
    supplierName: 'MacBook Specifications | FMI | MDM Check [By Serial Number]',
    turnaround: null,
    inputType: 'text',
  }),
  mappedCheck('698', 'macSpecifications', 0.25, 'IMEI', ['serial'], {
    notes: [
      'Serial input is posted using machine key IMEI. Custom-to-order (CTO) configurations excluded.',
    ],
    supplierName: 'MacBook Specifications Check [No CTO | By Serial Number]',
    turnaround: null,
    inputType: 'text',
  }),
  mappedCheck('713', 'macFindMy', 0.12, 'Sn', ['serial'], {
    supplierName: 'MacBook | iMac iCloud Find My Mac ON & OFF & Status Check',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('715', 'macFindMy', 0.13, 'Serial Number', ['serial'], {
    notes: [
      'Advertises old, T2 and M1 Mac models; do not silently widen to all Mac generations.',
    ],
    supplierName:
      'MacBook, iMac FMI Status Check | Old, T2 & M1 Models [FMI ON|OFF]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('714', 'macOwnershipStatus', 0.27, 'Serial Number', ['serial'], {
    supplierName:
      'MacBook | MacOS | iMac FMI ON/OFF & iCloud Clean/Lost Status Checker',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck(
    '705',
    'appleSalesCaseHistory',
    0.67,
    'IMEI/SN',
    ['imei', 'serial'],
    {
      supplierName:
        'Apple GSX Sold By | Case History | Replacement Check By IMEI | SN',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck(
    '710',
    'appleSalesCaseHistory',
    1.21,
    'IMEI or SN',
    ['imei', 'serial'],
    {
      supplierName:
        'Apple Sold By | Coverage Check By IMEI | SN [Instant] | Case History | Replacement History',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck(
    '708',
    'appleRepairHistory',
    3.0,
    'IMEI / SERIAL NO',
    ['imei', 'serial'],
    {
      supplierName:
        'Apple Sold by | Case | Repair | Replacement | Extra Info Check',
      turnaround: '1-10 Minutes',
      inputType: 'text_bulk',
    }
  ),
  mappedCheck('709', 'appleCaseHistory', 2.9, 'IMEI/SN', ['imei', 'serial'], {
    supplierName:
      'Apple Full GSX | Case | Replacement | +Extra Info Check By IMEI / SN',
    turnaround: '1-10 Minutes',
    inputType: 'text_bulk',
  }),
] as const;
