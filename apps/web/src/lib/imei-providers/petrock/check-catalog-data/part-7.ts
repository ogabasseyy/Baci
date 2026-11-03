import { mappedCheck } from './types';

export const PETROCK_CHECK_MAP_PART_7 = [
  mappedCheck('1420', 'xiaomiAccountLock', 0.12, 'LOCK CODE', ['xiaomi-code'], {
    notes: ['Requires Xiaomi lock code, not an IMEI-only request.'],
    supplierName: 'Xiaomi Device Info Checker [On & Off Check Only]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('1991', 'motorolaDetails', 0.08, 'IMEI', ['imei', 'serial'], {
    notes: [
      'The input label advertises IMEI / SN while the title says IMEI. Serial acceptance and response coverage require supplier verification.',
    ],
    supplierName: 'Motorola Full Info Check By IMEI [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck('4041', 'orangeContract', 0.56, 'IMEI', ['imei'], {
    supplierName: 'Orange Romania Contract Status Check [IMEI]',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('4042', 'asusWarranty', 0.56, 'IMEI', ['imei', 'serial'], {
    notes: [
      'ROG phones and graphics cards; graphics-card input needs a supported device form before ordering.',
    ],
    supplierName:
      'ASUS ROG Phones & Graphics Cards Warranty Check [IMEI / Serial Number]',
    turnaround: '1 Minutes',
    inputType: 'text',
  }),
  mappedCheck('640', 'tmobilePaidEligibility', 0.07, 'IMEI', ['imei'], {
    supplierName:
      'T-Mobile USA iPhone & Generic Models Fully Paid Eligibility Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1317', 'cricketEligibility', 0.49, 'IMEI', ['imei'], {
    supplierName: 'Cricket iPhone | Generic Unlock Eligibility Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1335', 'spectrumEligibility', 0.13, 'IMEI', ['imei'], {
    supplierName: 'USA Spectrum iPhone Eligibility Checker',
    turnaround: '1-30 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1355', 'metroStatus', 0.61, 'IMEI', ['imei'], {
    supplierName: 'MetroPCS USA iPhone & Generic Status Check [IMEI]',
    turnaround: null,
    inputType: 'imei',
  }),
  mappedCheck('1510', 'verizonEligibility', 0.13, 'IMEI', ['imei'], {
    supplierName:
      'Verizon USA Unlock Eligibility Check — iPhone, Samsung & Other Brands',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
] as const;
