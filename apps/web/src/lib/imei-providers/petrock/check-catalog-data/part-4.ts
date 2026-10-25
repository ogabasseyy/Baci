import { mappedCheck } from './types';

export const PETROCK_CHECK_MAP_PART_4 = [
  mappedCheck('1943', 'appleDetailedHistory', 1.4, 'IMEI', ['imei'], {
    supplierName:
      'Full GSX Report [Sold By Info | Case | Replacement History | GSX Activation | WiFi MAC Address]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('2776', 'appleActivationPolicyHistory', 0.69, 'IMEI', ['imei'], {
    supplierName:
      'Apple Full GSX Report [Sold By Info | Case | Replacement History | Activation Policy]',
    turnaround: '1-10 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('679', 'applePurchaseDate', 0.05, 'IMEI', ['imei'], {
    deviceScope: ['smartphone', 'tablet'],
    supplierName: 'Apple Purchase Date Check',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1967', 'appleWarranty', 0.04, 'IMEI', ['imei'], {
    supplierName: 'Apple Warranty Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1992', 'appleWarranty', 0.04, 'IMEI', ['imei'], {
    supplierName: 'Apple iPhone | iPad Warranty Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck(
    '1993',
    'appleWarranty',
    0.04,
    'IMEI/Serial Number',
    ['imei', 'serial'],
    {
      supplierName: 'Apple iPhone | iPad Warranty Check [Instant]',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck('1965', 'replacementStatus', 0.04, 'IMEI', ['imei'], {
    notes: [
      'Replaced-device status variant; retain its scope separately from the active-device query.',
    ],
    supplierName: 'Apple Replaced Device Status Check',
    turnaround: null,
    inputType: 'imei',
  }),
  mappedCheck('1966', 'replacementStatus', 0.04, 'IMEI', ['imei'], {
    notes: [
      'Active-device replacement query; not a full repair or replacement-history report.',
    ],
    supplierName: 'Apple Replacement Status [Active Device] Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1941', 'esimCompatibility', 0.04, 'IMEI', ['imei'], {
    supplierName:
      'Apple & Generic Model eSIM | Physical SIM [pSIM] Compatibility Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('689', 'carrierAndSim', 0.07, 'IMEI/SN:', ['imei', 'serial'], {
    supplierName: 'iPhone & iPad Carrier | SIMLock By [IMEI | SN]',
    turnaround: '1 Minutes',
    inputType: 'text',
  }),
  mappedCheck('716', 'simLock', 0.06, 'IMEI', ['imei'], {
    supplierName: 'iPhone Check Simlock Status [Instant]',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('741', 'samsungDetails', 0.08, 'IMEI', ['imei'], {
    supplierName: 'Samsung Full Info | Carrier | Warranty Checker [Instant]',
    turnaround: '1 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('1990', 'samsungSalesWarranty', 0.17, 'IMEI', ['imei'], {
    notes: [
      'Advertises sold-by country, sale date, warranty and carrier. This does not establish the original seller business.',
    ],
    supplierName:
      'Samsung Full Info | Model | Sold By Country | Sold Date | Warranty & Carrier Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('699', 'knoxGuard', 0.09, 'IMEI/Serial No', ['imei', 'serial'], {
    supplierName: 'Samsung IMEI Knox Guard Locked | Unlocked Check',
    turnaround: '1-5 Minutes',
    inputType: 'text',
  }),
  mappedCheck(
    '700',
    'knoxGuardEnrollment',
    0.14,
    'IMEI or Serial Number',
    ['imei', 'serial'],
    {
      notes: [
        'Knox Guard (KG) enrollment is not verified Knox Mobile Enrollment (KME) or MDM coverage.',
      ],
      supplierName: 'Samsung Knox Guard [KG] Enrollment Status Check',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
] as const;
