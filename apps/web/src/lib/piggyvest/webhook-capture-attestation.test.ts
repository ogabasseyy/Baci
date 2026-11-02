import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPiggyvestCaptureDrainScheduled,
  PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV,
} from './webhook-capture-attestation';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isPiggyvestCaptureDrainScheduled', () => {
  const read = (value: string | undefined) =>
    isPiggyvestCaptureDrainScheduled({
      [PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV]: value,
    } as unknown as NodeJS.ProcessEnv);

  it('names the documented attestation variable', () => {
    expect(PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV).toBe(
      'PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED'
    );
  });

  it('is true only for the exact string "true"', () => {
    expect(read('true')).toBe(true);
  });

  it.each([
    undefined,
    '',
    ' ',
    'TRUE',
    'True',
    '1',
    'yes',
    ' true',
    'true ',
    'false',
  ])('fails toward retry for %j', (value) => {
    expect(read(value)).toBe(false);
  });

  it('reads process.env at call time when no env is given', () => {
    vi.stubEnv(PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV, 'true');
    expect(isPiggyvestCaptureDrainScheduled()).toBe(true);
    vi.stubEnv(PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV, '');
    expect(isPiggyvestCaptureDrainScheduled()).toBe(false);
  });
});
