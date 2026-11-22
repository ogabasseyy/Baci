import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signQuizEdgeAdmissionTicket } from './quiz-edge-ticket';

describe('signQuizEdgeAdmissionTicket', () => {
  it('signs a bqt1 HMAC-SHA256 admission ticket verifiable by the edge worker', () => {
    const secret = randomBytes(32).toString('hex');
    const claims = {
      userId: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      merchantId: '33333333-3333-4333-8333-333333333333',
      eventId: '44444444-4444-4444-8444-444444444444',
      roomId: '44444444-4444-4444-8444-444444444444:room-0001',
      deviceHash: 'a'.repeat(64),
      leaderboardUsername: 'Ada',
      expiresAtMs: Date.now() + 60_000,
      mode: 'live' as const,
      maxAttempts: 1,
      admissionId: '55555555-5555-4555-8555-555555555555',
    };

    const ticket = signQuizEdgeAdmissionTicket(claims, secret);
    expect(ticket.startsWith('bqt1.')).toBe(true);
    const [, payloadB64, sigB64] = ticket.split('.');
    const expectedSig = createHmac('sha256', secret)
      .update(`bqt1.${payloadB64}`, 'utf8')
      .digest('base64url');
    expect(sigB64).toBe(expectedSig);
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    );
    expect(decoded).toEqual(claims);
  });
});
