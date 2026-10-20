import { describe, expect, it } from 'vitest';
import {
  assistanceFrameSchema,
  type SearchAssistanceFrame,
} from './assistance-frame';

describe('assistance-frame', () => {
  it('accepts a versioned frame and rejects unknown event kinds', () => {
    const frame: SearchAssistanceFrame = {
      version: 1,
      requestId: 'r1',
      sequence: 0,
      event: { kind: 'status', message: 'Thinking' },
    };
    expect(assistanceFrameSchema.parse(frame)).toEqual(frame);
    expect(() =>
      assistanceFrameSchema.parse({
        ...frame,
        event: { kind: 'add_to_cart', productId: 'forged' },
      })
    ).toThrow();
  });
});
