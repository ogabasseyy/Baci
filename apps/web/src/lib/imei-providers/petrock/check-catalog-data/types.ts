import type {
  ImeiCatalogBrand,
  ImeiCatalogDevice,
  ImeiCheckCatalogKey,
} from '@baci/shared/imei';
export type PetrockCheckIdentifier =
  | 'imei'
  | 'serial'
  | 'meid'
  | 'xiaomi-code'
  | 'pc-serial';
export interface PetrockCheckMapping {
  productId: string;
  entryId: ImeiCheckCatalogKey;
  costUsd: number;
  supplierName: string;
  turnaround: string | null;
  inputType: string;
  serialLengths?: readonly number[];
  orderFieldName: string;
  identifiers: readonly PetrockCheckIdentifier[];
  evidence: 'unverified' | 'successful_probe' | 'rejected_probe';
  /** Only these fields were observed, on an iPhone IMEI probe, not every supported device/input. */
  observedFields: readonly string[];
  notes: readonly string[];
  brandScope?: readonly ImeiCatalogBrand[];
  deviceScope?: readonly ImeiCatalogDevice[];
}
export function mappedCheck(
  productId: string,
  entryId: ImeiCheckCatalogKey,
  costUsd: number,
  orderFieldName: string,
  identifiers: readonly PetrockCheckIdentifier[],
  options: Pick<
    PetrockCheckMapping,
    'supplierName' | 'turnaround' | 'inputType'
  > &
    Partial<
      Pick<
        PetrockCheckMapping,
        | 'evidence'
        | 'observedFields'
        | 'notes'
        | 'brandScope'
        | 'deviceScope'
        | 'serialLengths'
      >
    >
): PetrockCheckMapping {
  return {
    productId,
    entryId,
    costUsd,
    orderFieldName,
    identifiers,
    evidence: 'unverified',
    observedFields: [],
    notes: [],
    ...options,
  };
}
