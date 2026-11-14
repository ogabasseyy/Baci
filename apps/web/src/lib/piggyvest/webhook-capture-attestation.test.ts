import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isPiggyvestCaptureDrainEnabled,
  isPiggyvestCaptureDrainScheduled,
  PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV,
  PIGGYVEST_CAPTURE_DRAIN_ENABLED_ENV,
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

describe('isPiggyvestCaptureDrainEnabled', () => {
  it('is a separate worker-host switch from the web attestation', () => {
    expect(PIGGYVEST_CAPTURE_DRAIN_ENABLED_ENV).toBe(
      'PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED'
    );
    expect(
      isPiggyvestCaptureDrainEnabled({
        [PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV]: 'true',
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it.each([
    ['true', true],
    ['TRUE', false],
    ['1', false],
    [' true', false],
    ['', false],
    [undefined, false],
  ])('treats %s as %s', (value, enabled) => {
    expect(
      isPiggyvestCaptureDrainEnabled({
        [PIGGYVEST_CAPTURE_DRAIN_ENABLED_ENV]: value,
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(enabled);
  });
});
