import { describe, expect, it } from 'vitest';
import {
  parsePilotAcceptance,
  pilotAcceptanceSchema,
} from './merchant-image-variant-pilot-acceptance';

const validAcceptance = {
  assetId: 'logo-1',
  generationId: 'a'.repeat(64),
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  note: 'Approved after visual comparison.',
  originalUrl: 'https://cdn.example.com/media/logo.png',
  outputHashes: ['b'.repeat(64)],
  qualities: [70 as const, null],
  recipeId: 'pilot-r2-7d207bbbac68d8ba',
  reviewedAt: '2026-10-01T21:00:00.000Z',
  reviewer: 'pilot-owner',
  schemaVersion: 1 as const,
  slotId: 'header-logo',
  sourceSha256: 'c'.repeat(64),
  verdict: 'accepted' as const,
};

describe('pilotAcceptanceSchema and parsePilotAcceptance', () => {
  it('accepts valid acceptance records and rejects invalid or unknown fields', () => {
    expect(pilotAcceptanceSchema.safeParse(validAcceptance).success).toBe(true);
    const parsed = parsePilotAcceptance(validAcceptance);
    expect(parsed).toEqual({ ok: true, record: validAcceptance });

    const invalid = parsePilotAcceptance({
      ...validAcceptance,
      extraField: true,
    });
    expect(invalid.ok).toBe(false);
  });
});
