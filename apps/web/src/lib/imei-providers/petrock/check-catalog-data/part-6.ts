import { mappedCheck } from './types';

export const PETROCK_CHECK_MAP_PART_6 = [
  mappedCheck('739', 'oppoWarranty', 0.19, 'IMEI', ['imei'], {
    supplierName: 'OPPO Model | Warranty Checker [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('740', 'oppoFamilyDetails', 0.2, 'IMEI', ['imei'], {
    supplierName: 'OPPO | One Plus | Realme Full Info Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('743', 'tracfoneStatus', 0.09, 'IMEI', ['imei'], {
    supplierName: 'USA TracFone | StraightTalk Status Check',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('746', 'tmobileStatus', 0.07, 'IMEI', ['imei'], {
    supplierName:
      'USA T-Mobile Pro Status Check [Clean | Lost | Stolen | Blocked | Unpaid]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1958', 'tmobileStatus', 0.06, 'IMEI', ['imei'], {
    supplierName:
      'USA T-Mobile Pro ESN Status Check [Clean | Lost | Stolen | Blocked | Unpaid]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('749', 'verizonDeviceStatus', 0.08, 'IMEI', ['imei'], {
    supplierName: 'Verizon USA [Clean | Blocked | Unpaid] Status Check',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1957', 'attStatus', 0.08, 'IMEI', ['imei'], {
    supplierName: 'USA AT&T Status Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1959', 'verizonFinance', 0.05, 'IMEI', ['imei'], {
    supplierName: 'USA Verizon Finance Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1960', 'verizonLostStatus', 0.06, 'IMEI', ['imei'], {
    supplierName: 'Verizon USA Clean | Lost Status Check [By IMEI]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('2015', 'xfinityEligibility', 0.13, 'IMEI', ['imei'], {
    notes: [
      'Unlock eligibility only; no finance-balance field or unlock operation is established.',
    ],
    supplierName: 'Xfinity USA Unlock Eligibilty Check',
    turnaround: null,
    inputType: 'imei',
  }),
  mappedCheck('751', 'zteDetails', 0.08, 'IMEI', ['imei'], {
    supplierName:
      'ZTE Full Info | Carrier | Warranty | Activation | Production Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1969', 'zteDetails', 0.07, 'IMEI', ['imei', 'serial'], {
    supplierName:
      'ZTE Full Info | Carrier | Warranty | Activation | Production Check By IMEI | SN',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('719', 'xiaomiCodeConversion', 0.56, 'Keylock', ['xiaomi-code'], {
    notes: [
      'Requires Xiaomi lock code. Returns identifier plus advertised lost/clean check; not interchangeable with an IMEI model lookup.',
    ],
    supplierName:
      'Convert Xiaomi Lock Code to IMEI [With Xiaomi Clean|Lost Checker]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('1418', 'xiaomiDetails', 0.08, 'IMEI', ['imei'], {
    supplierName: 'Xiaomi Device Full Info Checker By IMEI Only',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck(
    '1419',
    'xiaomiLostStatus',
    0.61,
    'IMEI/CODE',
    ['imei', 'serial', 'xiaomi-code'],
    {
      notes: [
        'Provider advertises IMEI, serial or lock key; bulk text input. Turnaround is 1–6 hours; do not promise instant completion.',
      ],
      supplierName:
        'Xiaomi Find Device | Country | Lost/Clean Check [IMEI | SN | New Key]',
      turnaround: '1-6 Hours',
      inputType: 'text_bulk',
    }
  ),
] as const;
