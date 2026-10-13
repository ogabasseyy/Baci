import { createDecipheriv, createHash } from 'node:crypto';
import {
  type BankTransferInflowSuccessEvent,
  type BankTransferOutflowFailedEvent,
  type BankTransferOutflowSuccessEvent,
  bankTransferInflowSuccessEventSchema,
  bankTransferOutflowFailedEventSchema,
  bankTransferOutflowSuccessEventSchema,
  type InterestPayoutSuccessEvent,
  interestPayoutSuccessEventSchema,
  type WalletTransferOutflowSuccessEvent,
  walletTransferOutflowSuccessEventSchema,
} from '../../src/schemas/piggyvest/events';
import {
  type InterestAccruedSuccessEvent,
  interestAccruedSuccessEventSchema,
} from '../../src/schemas/piggyvest/interest-accrued-event';
import { intakeSchema } from './intake-schema';

export type ReplayEvent =
  | BankTransferInflowSuccessEvent
  | InterestAccruedSuccessEvent
  | InterestPayoutSuccessEvent
  | BankTransferOutflowSuccessEvent
  | BankTransferOutflowFailedEvent
  | WalletTransferOutflowSuccessEvent;
export type SealedReplayReceipt = {
  payloadSha256: string;
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: 'staging-v1';
};

export class ReplayValidationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ReplayValidationError';
  }
}

function fail(reason: string): never {
  throw new ReplayValidationError(reason);
}

function parseJson(raw: Buffer): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return fail('invalid-utf8');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail('invalid-json');
  }
}

function parseEvent(value: unknown): ReplayEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('invalid-event');
  }
  const eventType = (value as { eventType?: unknown }).eventType;
  if (eventType === 'bank-transfer.inflow.success') {
    const parsed = bankTransferInflowSuccessEventSchema.safeParse(value);
    if (!parsed.success) return fail('invalid-event');
    if (parsed.data.eventData.customer_id !== parsed.data.customer_id) {
      return fail('customer-mismatch');
    }
    return parsed.data;
  }
  if (eventType === 'interest-payout.success') {
    const parsed = interestPayoutSuccessEventSchema.safeParse(value);
    if (!parsed.success) return fail('invalid-event');
    return parsed.data;
  }
  if (eventType === 'interest-accrued.success') {
    const parsed = interestAccruedSuccessEventSchema.safeParse(value);
    if (!parsed.success) return fail('invalid-event');
    return parsed.data;
  }
  const outflowSchema =
    eventType === 'wallet-transfer.outflow.success'
      ? walletTransferOutflowSuccessEventSchema
      : eventType === 'bank-transfer.outflow.success'
        ? bankTransferOutflowSuccessEventSchema
        : eventType === 'bank-transfer.outflow.failed'
          ? bankTransferOutflowFailedEventSchema
          : null;
  if (outflowSchema) {
    const parsed = outflowSchema.safeParse(value);
    if (!parsed.success) return fail('invalid-event');
    return parsed.data;
  }
  return fail('unsupported-event');
}

export function decryptSealedReceipt(
  input: SealedReplayReceipt,
  encryptionKey: Buffer
): { raw: Buffer; event: ReplayEvent } {
  const receipt = intakeSchema.safeParse(input);
  if (!receipt.success || encryptionKey.length !== 32)
    return fail('invalid-receipt');
  let raw: Buffer;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey,
      Buffer.from(receipt.data.nonce, 'base64')
    );
    decipher.setAAD(
      Buffer.from(
        `piggyvest-staging:${receipt.data.keyVersion}:${receipt.data.payloadSha256}`
      )
    );
    decipher.setAuthTag(Buffer.from(receipt.data.authTag, 'base64'));
    raw = Buffer.concat([
      decipher.update(Buffer.from(receipt.data.ciphertext, 'base64')),
      decipher.final(),
    ]);
  } catch {
    return fail('authentication-failed');
  }
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== receipt.data.payloadSha256) return fail('digest-mismatch');
  const event = parseEvent(parseJson(raw));
  return { raw, event };
}

export function decryptAndValidateReceipt(
  input: SealedReplayReceipt,
  encryptionKey: Buffer,
  leaseEventId: string | null
): { raw: Buffer; event: ReplayEvent } {
  if (
    leaseEventId !== null &&
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(leaseEventId)
  ) {
    return fail('unstable-event-id');
  }
  const { raw, event } = decryptSealedReceipt(input, encryptionKey);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(event.eventId))
    return fail('unstable-event-id');
  if (leaseEventId !== null && event.eventId !== leaseEventId)
    return fail('event-id-mismatch');
  return { raw, event };
}
