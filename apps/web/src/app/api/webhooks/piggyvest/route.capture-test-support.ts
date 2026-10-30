import { createHash } from 'node:crypto';
import { vi } from 'vitest';

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
  keyFamilies: string[];
  keyStatus: string;
  eventType: string | null;
  processingState: 'pending' | 'processed';
}

/**
 * In-memory stand-in for the database capture functions. It mirrors the SQL
 * contract the route relies on: an atomic insert that recomputes the body
 * digest, dedupe on (event key, body digest), and inline completion that
 * only ever moves a row to processed. `failCapture` simulates an outage.
 */
export function createFakeCaptureStore() {
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
              const row = store.rows.find(
                (candidate) => candidate.id === args.p_id
              );
              if (row && args.p_state === 'processed') {
                row.processingState = 'processed';
              }
              return Promise.resolve({ data: true, error: null });
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
    capture(command: Record<string, unknown>): CaptureRpcResult {
      const raw = Buffer.from(String(command.rawHex), 'hex');
      const digest = createHash('sha256').update(raw).digest('hex');
      if (digest !== command.bodyDigest) {
        return { data: null, error: { message: 'digest mismatch' } };
      }
      const eventKey = (command.eventId as string | null) ?? `raw:${digest}`;
      const existing = store.rows.find(
        (row) => row.eventKey === eventKey && row.bodyDigest === digest
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
        keyFamilies: command.keyFamilies as string[],
        keyStatus: String(command.keyStatus),
        eventType: (command.eventType as string | null) ?? null,
        processingState: 'pending',
      };
      store.rows.push(row);
      return capturedReceipt({ id: row.id });
    },
  };
  return store;
}
