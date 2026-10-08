import { describe, expect, it } from 'vitest';
import {
  PILOT_MAX_DECODE_CHANNELS,
  PILOT_MAX_DECODED_PIXELS,
  PILOT_SHARP_LIMITS,
} from '@/schemas/merchant-image-variant-pilot';
import {
  MAX_DECODED_PIXELS,
  SHARP_LIMITS,
} from '../../../../../infra/cdn-transformer/pilot/constants.mjs';

// The web runtime cannot import infra directly, so the decode limits
// mirror the transformer originals. Pin them: any drift silently lets
// lab verification certify inputs the generator would refuse to encode.
describe('lab decode limits parity', () => {
  it('matches the generator pixel ceiling', () => {
    expect(PILOT_MAX_DECODED_PIXELS).toBe(MAX_DECODED_PIXELS);
  });

  it('matches the generator sharp limits object', () => {
    expect({ ...PILOT_SHARP_LIMITS }).toEqual(SHARP_LIMITS);
    expect(PILOT_SHARP_LIMITS.limitInputChannels).toBe(
      PILOT_MAX_DECODE_CHANNELS
    );
  });
});
