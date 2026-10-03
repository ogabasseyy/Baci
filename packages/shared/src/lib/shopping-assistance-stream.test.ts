import { describe, expect, it } from 'vitest';
import {
  createAssistanceDecoder,
  encodeAssistanceFrame,
} from './shopping-assistance-stream';

describe('assistance stream', () => {
  it('delivers only complete validated frames across chunk splits', () => {
    const frames: unknown[] = [];
    const parser = createAssistanceDecoder('r1', (f) => frames.push(f));
    const status = encodeAssistanceFrame({
      version: 1,
      requestId: 'r1',
      sequence: 0,
      event: { kind: 'status', message: 'Thinking' },
    });
    parser.push(status.slice(0, 8));
    expect(frames).toHaveLength(0);
    parser.push(status.slice(8));
    parser.push(
      encodeAssistanceFrame({
        version: 1,
        requestId: 'r1',
        sequence: 1,
        event: { kind: 'done' },
      })
    );
    parser.finish();
    expect(frames).toHaveLength(2);
  });
  it('rejects stale IDs, duplicates, truncated and oversized responses', () => {
    const frame = encodeAssistanceFrame({
      version: 1,
      requestId: 'r1',
      sequence: 0,
      event: { kind: 'status', message: 'Thinking' },
    });
    expect(() => createAssistanceDecoder('r2', () => {}).push(frame)).toThrow();
    const parser = createAssistanceDecoder('r1', () => {});
    parser.push(frame);
    expect(() => parser.push(frame)).toThrow();
    expect(() => createAssistanceDecoder('r1', () => {}).finish()).toThrow();
    expect(() =>
      createAssistanceDecoder('r1', () => {}).push('x'.repeat(8193))
    ).toThrow();
  });
});
it('rejects unknown cart events, forged actions and frames after completion', () => {
  const parser = createAssistanceDecoder('r1', () => {});
  expect(() =>
    parser.push(
      `${JSON.stringify({
        version: 1,
        requestId: 'r1',
        sequence: 0,
        event: { kind: 'add_to_cart', productId: 'forged' },
      })}\n`
    )
  ).toThrow();
  const completed = createAssistanceDecoder('r1', () => {});
  completed.push(
    encodeAssistanceFrame({
      version: 1,
      requestId: 'r1',
      sequence: 0,
      event: { kind: 'done' },
    })
  );
  expect(() => completed.push('x')).toThrow();
});
