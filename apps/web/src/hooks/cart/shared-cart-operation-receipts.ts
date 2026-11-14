import type { CartCommand } from '@baci/shared/cart';
import { experienceEngineCommandSchema } from '@/schemas/experience-cart-command';
export interface SharedCartOperationReceipt {
  operationId: string;
  expectedVersion: number;
  command: CartCommand;
  partition: string;
  commandHash?: string;
  state:
    | 'prepared'
    | 'wire-attempted'
    | 'confirmed'
    | 'indeterminate'
    | 'cancelled-unsent';
}
export interface ReceiptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = 'baci-experience-cart-receipts-v1';
const envelope = (r: SharedCartOperationReceipt) =>
  JSON.stringify([r.operationId, r.expectedVersion, r.command, r.partition]);
function read(storage: ReceiptStorage): SharedCartOperationReceipt[] {
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > 131072) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 64) return [];
    return values.filter(
      (r): r is SharedCartOperationReceipt =>
        typeof r === 'object' &&
        r !== null &&
        Object.keys(r).every((k) =>
          [
            'operationId',
            'expectedVersion',
            'command',
            'partition',
            'state',
            'commandHash',
          ].includes(k)
        ) &&
        (r.commandHash === undefined ||
          (typeof r.commandHash === 'string' &&
            /^[a-f0-9]{64}$/.test(r.commandHash))) &&
        typeof r.operationId === 'string' &&
        r.operationId.length <= 128 &&
        typeof r.partition === 'string' &&
        r.partition.length <= 128 &&
        Number.isInteger(r.expectedVersion) &&
        r.expectedVersion >= 1 &&
        [
          'prepared',
          'wire-attempted',
          'confirmed',
          'indeterminate',
          'cancelled-unsent',
        ].includes(r.state) &&
        experienceEngineCommandSchema.safeParse(r.command).success
    );
  } catch {
    return [];
  }
}
/** Public SDK commands only: caller never supplies negotiation/voucher/account fields. */
export function createSharedCartReceiptStore(storage: ReceiptStorage) {
  return {
    get(partition: string, operationId: string) {
      return (
        read(storage).find(
          (r) => r.partition === partition && r.operationId === operationId
        ) ?? null
      );
    },
    put(receipt: SharedCartOperationReceipt) {
      if (!experienceEngineCommandSchema.safeParse(receipt.command).success)
        return false;
      const values = read(storage);
      const previous = values.find(
        (r) =>
          r.operationId === receipt.operationId &&
          r.partition === receipt.partition
      );
      if (previous && envelope(previous) !== envelope(receipt))
        throw Error('IDEMPOTENCY_CONFLICT');
      const next = [
        ...values.filter((r) => r !== previous),
        structuredClone(receipt),
      ].slice(-64);
      const raw = JSON.stringify(next);
      if (raw.length > 131072) return false;
      try {
        storage.setItem(KEY, raw);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function stablePublicEnvelope(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stablePublicEnvelope);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stablePublicEnvelope(v)])
    );
  return value;
}
export async function hashCartOperation(input: {
  operationId: string;
  expectedVersion: number;
  command: CartCommand;
  partition: string;
}) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(stablePublicEnvelope(input))
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}
