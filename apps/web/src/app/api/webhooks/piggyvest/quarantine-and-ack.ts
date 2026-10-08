import { NextResponse } from 'next/server';
import {
  digestRawBody,
  recordQuarantineEvent,
} from '@/lib/piggyvest/event-quarantine';
import { createPiggyvestIntakeServiceClient } from '@/lib/piggyvest/server-intake-client';

export type PiggyvestQuarantineReason =
  | 'unparseable'
  | 'unknown-event'
  | 'conflict'
  | 'key-family';

const noStore = { 'Cache-Control': 'no-store' };

export async function quarantineAndAck(
  rawBody: Buffer,
  reason: PiggyvestQuarantineReason,
  correlation: { eventId?: string; eventType?: string },
  detail: Record<string, unknown> | null
): Promise<Response> {
  try {
    await recordQuarantineEvent(createPiggyvestIntakeServiceClient(), {
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
