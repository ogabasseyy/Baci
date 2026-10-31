import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { deterministicTestUuid } from '@/lib/piggyvest/deterministic-test-data.test-support';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';

/**
 * Shared test double for the durable capture RPCs. Every authentic
 * delivery is captured before processing, so route tests that mock the
 * intake client for processing also need the capture functions to exist.
 */
export const CAPTURE_ID = '4204dc18-efb3-44d0-b9a2-1362448d4f21';

export type CaptureRpcResult = { data: unknown; error: unknown };

export function capturedReceipt(
  overrides: Record<string, unknown> = {}
): CaptureRpcResult {
  return {
    data: {
      outcome: 'captured',
      id: CAPTURE_ID,
      processingState: 'pending',
      ...overrides,
    },
    error: null,
  };
}

export function createCaptureRpc(
  capture: () => Promise<CaptureRpcResult> = () =>
    Promise.resolve(capturedReceipt())
) {
  return vi.fn((name: string): Promise<CaptureRpcResult> => {
    if (name === 'capture_piggyvest_webhook_delivery') return capture();
    return Promise.resolve({ data: true, error: null });
  });
}

/** Adds the capture RPCs to a mocked intake client without replacing it. */
export function withCaptureRpc<T extends object>(
  client: T | undefined,
  rpc: ReturnType<typeof createCaptureRpc> = createCaptureRpc()
): T & { rpc: ReturnType<typeof createCaptureRpc> } {
  return Object.assign(client ?? {}, { rpc }) as T & {
    rpc: ReturnType<typeof createCaptureRpc>;
  };
}

export interface FakeCaptureRow {
  id: string;
  eventKey: string;
  bodyDigest: string;
  rawHex: string;
  signature: string;
  headers: Record<string, string>;
  keyVersion: string;
  keyFamilies: PiggyvestClaimedCapture['key_families'];
  keyStatus: string;
  /** Sorted, comma-joined matched families: part of the capture identity. */
  signingFamilies: string;
  eventType: string | null;
  providerTransactionId: string | null;
  processingState: 'pending' | 'claimed' | 'processed' | 'needs_review';
  claimToken: string | null;
  attempts: number;
}

/**
 * In-memory stand-in for the database capture functions. It mirrors the SQL
 * contract the route relies on: an atomic insert that recomputes the body
 * digest, dedupe on (event key, body digest, matched signing families),
 * inline completion that only ever moves a pending row to processed, and
 * the worker claim/lease/resolve cycle. `failCapture` simulates an outage.
 */
export function createFakeCaptureStore() {
  let claimSequence = 0;
  const store = {
    rows: [] as FakeCaptureRow[],
    resolveCalls: [] as Record<string, unknown>[],
    failCapture: false,
    client() {
      return {
        rpc: vi.fn(
          (
            name: string,
            args: Record<string, unknown>
          ): Promise<CaptureRpcResult> => {
            if (name === 'resolve_piggyvest_webhook_capture') {
              store.resolveCalls.push(args);
              return Promise.resolve({
                data: store.resolve(args),
                error: null,
              });
            }
            if (store.failCapture) {
              return Promise.resolve({
                data: null,
                error: { message: 'synthetic storage outage' },
              });
            }
            return Promise.resolve(
              store.capture(args.p_command as Record<string, unknown>)
            );
          }
        ),
        from: vi.fn(() => {
          throw new Error('processing storage is mocked out in this suite');
        }),
      };
    },
    /** Mirrors resolve_piggyvest_webhook_capture's fencing rules. */
    resolve(args: Record<string, unknown>): boolean {
      const row = store.rows.find((candidate) => candidate.id === args.p_id);
      if (!row) return false;
      const token = args.p_claim_token as string | null;
      // Tokenless inline completion: only a pending row, except that a
      // successful retry also closes a needs_review row (as the SQL does).
      const fenced =
        token === null
          ? row.processingState === 'pending' ||
            (args.p_state === 'processed' &&
              row.processingState === 'needs_review')
          : row.processingState === 'claimed' && row.claimToken === token;
      if (!fenced) return false;
      // 'deferred' releases the row to pending and refunds the claim's
      // attempt, as resolve_piggyvest_webhook_capture does.
      const deferred = args.p_state === 'deferred';
      row.processingState = deferred
        ? 'pending'
        : (args.p_state as FakeCaptureRow['processingState']);
      if (deferred) row.attempts = Math.max(row.attempts - 1, 0);
      row.claimToken = null;
      return true;
    },
    /** Mirrors claim_piggyvest_webhook_captures for pending rows. */
    claim(limit: number): PiggyvestClaimedCapture[] {
      const due = store.rows
        .filter((row) => row.processingState === 'pending')
        .slice(0, limit);
      return due.map((row) => {
        row.processingState = 'claimed';
        row.claimToken = deterministicTestUuid(
          `fake-store-claim:${++claimSequence}`
        );
        row.attempts += 1;
        return {
          capture_id: row.id,
          claim_token: row.claimToken,
          raw_hex: row.rawHex,
          signature: row.signature,
          key_version: row.keyVersion,
          key_families: row.keyFamilies,
          attempts: row.attempts,
          event_type: row.eventType,
          provider_transaction_id: row.providerTransactionId,
        };
      });
    },
    capture(command: Record<string, unknown>): CaptureRpcResult {
      const raw = Buffer.from(String(command.rawHex), 'hex');
      const digest = createHash('sha256').update(raw).digest('hex');
      if (digest !== command.bodyDigest) {
        return { data: null, error: { message: 'digest mismatch' } };
      }
      const eventKey = (command.eventId as string | null) ?? `raw:${digest}`;
      const signingFamilies = [...new Set(command.keyFamilies as string[])]
        .sort()
        .join(',');
      const existing = store.rows.find(
        (row) =>
          row.eventKey === eventKey &&
          row.bodyDigest === digest &&
          row.signingFamilies === signingFamilies
      );
      if (existing) {
        return capturedReceipt({
          outcome: 'duplicate',
          id: existing.id,
          processingState: existing.processingState,
        });
      }
      const row: FakeCaptureRow = {
        id: `00000000-0000-4000-8000-${String(store.rows.length + 1).padStart(12, '0')}`,
        eventKey,
        bodyDigest: digest,
        rawHex: String(command.rawHex),
        signature: String(command.signature),
        headers: command.headers as Record<string, string>,
        keyVersion: String(command.keyVersion),
        keyFamilies:
          command.keyFamilies as PiggyvestClaimedCapture['key_families'],
        keyStatus: String(command.keyStatus),
        signingFamilies,
        eventType: (command.eventType as string | null) ?? null,
        providerTransactionId:
          (command.providerTransactionId as string | null) ?? null,
        processingState: 'pending',
        claimToken: null,
        attempts: 0,
      };
      store.rows.push(row);
      return capturedReceipt({ id: row.id });
    },
  };
  return store;
}
