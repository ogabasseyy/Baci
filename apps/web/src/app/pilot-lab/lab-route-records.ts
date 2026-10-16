// Raw operator-record parsing for the lab-only pilot routes, split out
// of lab-route.ts under the repo line ceiling: inventory/acceptance
// shape validation with lab input-validation errors (never incidental
// TypeErrors), before the verified lab-config builder runs.
import { PILOT_SCHEMA_VERSION } from '@/schemas/merchant-image-variant-pilot-constants';
import { isSafeRelativePath } from './lab-safe-path';

export interface RawInventoryRecord {
  assetId: string;
  merchantId: string;
  role: string;
  sha256: string;
  slot: string;
  sourcePath: string;
  url: string;
}

const RECORD_STRING_FIELDS = [
  'assetId',
  'merchantId',
  'role',
  'sha256',
  'slot',
  'sourcePath',
  'url',
] as const;

export function parseRawInventoryRecords(value: unknown): RawInventoryRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('merchant image pilot: inventory.json must be an array');
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(
        `merchant image pilot: inventory[${index}] is not a record`
      );
    }
    const record = entry as Record<string, unknown>;
    for (const field of RECORD_STRING_FIELDS) {
      if (
        typeof record[field] !== 'string' ||
        (record[field] as string).length === 0
      ) {
        throw new Error(
          `merchant image pilot: inventory[${index}].${field} must be a nonempty string`
        );
      }
    }
    if (!isSafeRelativePath(record.sourcePath as string)) {
      throw new Error(
        `merchant image pilot: inventory[${index}].sourcePath must be a safe relative path`
      );
    }
    // The generator's readInventoryJobs rejects non-current versions;
    // the route must refuse them too instead of normalizing a future
    // record shape into the current binding.
    if (record.schemaVersion !== PILOT_SCHEMA_VERSION) {
      throw new Error(
        `merchant image pilot: inventory[${index}].schemaVersion must be ${PILOT_SCHEMA_VERSION}`
      );
    }
    return {
      assetId: record.assetId as string,
      merchantId: record.merchantId as string,
      role: record.role as string,
      sha256: record.sha256 as string,
      slot: record.slot as string,
      sourcePath: record.sourcePath as string,
      url: record.url as string,
    };
  });
}

export function parseRawAcceptances(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('merchant image pilot: acceptances.json must be an array');
  }
  // Elements stay unknown (the lab-index schema validates their shape),
  // but non-objects fail here with an input-validation error instead of
  // an incidental TypeError deeper in the loader.
  for (const [index, element] of value.entries()) {
    if (
      typeof element !== 'object' ||
      element === null ||
      Array.isArray(element)
    ) {
      throw new Error(
        `merchant image pilot: acceptances[${index}] must be an object`
      );
    }
  }
  return value;
}
