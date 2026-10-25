import { mappedCheck } from './types';

export const PETROCK_CHECK_MAP_PART_5 = [
  mappedCheck('721', 'pixelDetails', 0.09, 'IMEI', ['imei'], {
    supplierName: 'Google Pixel Info Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck(
    '722',
    'honorWarrantyNetwork',
    0.56,
    'IMEI or Serial Number',
    ['imei', 'serial'],
    {
      supplierName: 'Honor Carrier | Warranty Check By IMEI | SN',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck('723', 'honorDetails', 0.08, 'IMEI', ['imei'], {
    supplierName: 'HONOR Info Check [By IMEI]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck(
    '725',
    'huaweiIdentifier',
    0.05,
    'IMEI or Serial Number',
    ['imei', 'serial'],
    {
      supplierName: 'Huawei Basic Info [Convert SN to IMEI]',
      turnaround: '1-5 Minutes',
      inputType: 'text',
    }
  ),
  mappedCheck('726', 'huaweiWarranty', 0.12, 'IMEI', ['imei'], {
    supplierName: 'Huawei Full Info | Carrier | Warranty Checker [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('727', 'huaweiWarranty', 0.08, 'IMEI', ['imei'], {
    supplierName: 'Huawei Full Info | Warranty Checker [Source B]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('728', 'transsionWarranty', 0.07, 'IMEI', ['imei'], {
    supplierName:
      'Infinix | Tecno | Itel Activation Date | Warranty Status Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('729', 'kddiDeviceStatus', 0.04, 'IMEI', ['imei'], {
    supplierName: 'Japan AU KDDI Status Check By IMEI',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('731', 'kddiDeviceStatus', 0.08, 'IMEI', ['imei'], {
    supplierName: 'Japan KDDI IMEI Status Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('730', 'kddiFinance', 0.07, 'IMEI', ['imei'], {
    supplierName: 'Japan KDDI Finance Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('732', 'docomoFinance', 0.09, 'IMEI', ['imei'], {
    supplierName: 'Japan NTT Docomo Finance Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('733', 'softbankFinance', 0.07, 'IMEI', ['imei'], {
    supplierName: 'Japan Softbank Finance Check',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('734', 'lenovoMobileWarranty', 0.07, 'IMEI', ['imei'], {
    supplierName: 'Lenovo Warranty | Full Info Check By IMEI [Instant]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
  mappedCheck('736', 'lgDetails', 0.05, 'IMEI/SERIAL', ['imei', 'serial'], {
    supplierName: 'LG Full Info Checker [By IMEI|SN]',
    turnaround: '1-5 Minutes',
    inputType: 'text_bulk',
  }),
  mappedCheck('738', 'oneplusDetails', 0.08, 'IMEI', ['imei'], {
    supplierName: 'OnePlus Info Check [By IMEI]',
    turnaround: '1-5 Minutes',
    inputType: 'imei',
  }),
] as const;
