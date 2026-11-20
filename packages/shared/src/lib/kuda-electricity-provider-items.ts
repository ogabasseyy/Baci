const AEDC_ITEMS = [
  { itemCode: 'KUD-ELE-AEDC-002', itemName: 'AEDC PREPAID' },
  { itemCode: 'KUD-ELE-AEDC-001', itemName: 'AEDC POSTPAID' },
] as const;
const APLE_ITEMS = [
  { itemCode: 'KUD-ELE-APLE-001', itemName: 'APLE PREPAID' },
  { itemCode: 'KUD-ELE-APLE-002', itemName: 'APLE POSTPAID' },
] as const;
const BEDC_ITEMS = [
  { itemCode: 'KUD-ELE-BEDC-002', itemName: 'BEDC PREPAID' },
  { itemCode: 'KUD-ELE-BEDC-001', itemName: 'BEDC POSTPAID' },
] as const;
const EEDC_ITEMS = [
  { itemCode: 'KUD-ELE-EEDC-002', itemName: 'EEDC PREPAID' },
  { itemCode: 'KUD-ELE-EEDC-001', itemName: 'EEDC POSTPAID' },
] as const;
const EKED_ITEMS = [
  { itemCode: 'KUD-ELE-EKED-002', itemName: 'EKEDC PREPAID' },
  { itemCode: 'KUD-ELE-EKED-001', itemName: 'EKEDC POSTPAID' },
] as const;
const IBED_ITEMS = [
  { itemCode: 'KUD-ELE-IBED-002', itemName: 'IBEDC PREPAID' },
  { itemCode: 'KUD-ELE-IBED-001', itemName: 'IBEDC POSTPAID' },
] as const;
const IKED_ITEMS = [
  { itemCode: 'KUD-ELE-IKED-002', itemName: 'IKEDC PREPAID' },
  { itemCode: 'KUD-ELE-IKED-001', itemName: 'IKEDC POSTPAID' },
] as const;
const JEDC_ITEMS = [
  { itemCode: 'KUD-ELE-JEDC-001', itemName: 'JEDC PREPAID' },
  { itemCode: 'KUD-ELE-JEDC-002', itemName: 'JEDC POSTPAID' },
] as const;
const KAED_ITEMS = [
  { itemCode: 'KUD-ELE-KAED-002', itemName: 'KAEDCO PREPAID' },
  { itemCode: 'KUD-ELE-KAED-001', itemName: 'KAEDCO POSTPAID' },
] as const;
const KEDC_ITEMS = [
  { itemCode: 'KUD-ELE-KEDC-002', itemName: 'KEDCO PREPAID' },
  { itemCode: 'KUD-ELE-KEDC-001', itemName: 'KEDCO POSTPAID' },
] as const;
const PHED_ITEMS = [
  { itemCode: 'KUD-ELE-PHED-002', itemName: 'PHED PREPAID' },
  { itemCode: 'KUD-ELE-PHED-001', itemName: 'PHED POSTPAID' },
] as const;
const YEDC_ITEMS = [
  { itemCode: 'KUD-ELE-YEDC-001', itemName: 'YEDC PREPAID' },
  { itemCode: 'KUD-ELE-YEDC-002', itemName: 'YEDC POSTPAID' },
] as const;

/**
 * Kuda's standard electricity meter products (prepaid and postpaid) per
 * distribution company, keyed by every name its biller goes by.
 */
export const KUDA_ELECTRICITY_BILL_ITEMS_BY_PROVIDER: Record<
  string,
  readonly { itemCode: string; itemName: string }[]
> = {
  AEDC: AEDC_ITEMS,
  APLE: APLE_ITEMS,
  BEDC: BEDC_ITEMS,
  EEDC: EEDC_ITEMS,
  EKED: EKED_ITEMS,
  EKEDC: EKED_ITEMS,
  IBED: IBED_ITEMS,
  IBEDC: IBED_ITEMS,
  IKED: IKED_ITEMS,
  IKEDC: IKED_ITEMS,
  JEDC: JEDC_ITEMS,
  KAED: KAED_ITEMS,
  KAEDC: KAED_ITEMS,
  KAEDCO: KAED_ITEMS,
  KEDC: KEDC_ITEMS,
  KEDCO: KEDC_ITEMS,
  PHED: PHED_ITEMS,
  YEDC: YEDC_ITEMS,
};
