import { NextResponse } from 'next/server';
import {
  digestRawBody,
  recordQuarantineEvent,
} from '@/lib/piggyvest/event-quarantine';

export type PiggyvestQuarantineReason =
  | 'unparseable'
  | 'unknown-event'
  | 'conflict'
  | 'key-family';

type IntakeClient = Parameters<typeof recordQuarantineEvent>[0];

const noStore = { 'Cache-Control': 'no-store' };

/**
 * Durable-receipt helper for the webhook route. The service-client factory
 * is injected by the caller: the event-pipeline boundary permits API
 * routes to reach the intake service authority directly, but not through
 * an intermediate importer, so this module must never import it.
 */
export async function quarantineAndAck(
  rawBody: Buffer,
  reason: PiggyvestQuarantineReason,
  correlation: { eventId?: string; eventType?: string },
  detail: Record<string, unknown> | null,
  createClient: () => IntakeClient
): Promise<Response> {
  try {
    await recordQuarantineEvent(createClient(), {
      bodyDigest: digestRawBody(rawBody),
      reason,
      eventId: correlation.eventId,
      eventType: correlation.eventType,
      detail,
    });
  } catch {
    return NextResponse.json(
      { error: 'Event intake unavailable', code: 'PIGGYVEST_INBOX_ERROR' },
      { status: 503, headers: noStore }
    );
  }
  return NextResponse.json(
    { received: true, quarantined: true },
    { status: 200, headers: noStore }
  );
}
