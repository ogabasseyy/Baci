import { describe, expect, it, vi } from 'vitest';
import type { SearchAssistanceFrame } from './assistance-frame';
import { encodeAssistanceFrame } from './encode-assistance-frame';
import { readAssistanceStream } from './read-assistance-stream';

describe('read-assistance-stream', () => {
  it('delivers streamed frames until done', async () => {
    const frames: SearchAssistanceFrame[] = [];
    const response = new Response(
      encodeAssistanceFrame({
        version: 1,
        requestId: 'r1',
        sequence: 0,
        event: { kind: 'status', message: 'Thinking' },
      }) +
        encodeAssistanceFrame({
          version: 1,
          requestId: 'r1',
          sequence: 1,
          event: { kind: 'done' },
        })
    );
    await readAssistanceStream(
      response,
      'r1',
      new AbortController().signal,
      (frame) => frames.push(frame)
    );
    expect(frames.map((frame) => frame.event.kind)).toEqual(['status', 'done']);
  });

  it('fails closed on error responses and aborts', async () => {
    const onFrame = vi.fn();
    await expect(
      readAssistanceStream(
        new Response('nope', { status: 500 }),
        'r1',
        new AbortController().signal,
        onFrame
      )
    ).rejects.toThrow('Assistance unavailable');
    const controller = new AbortController();
    controller.abort();
    await expect(
      readAssistanceStream(
        new Response('pending'),
        'r1',
        controller.signal,
        onFrame
      )
    ).rejects.toThrow('Cancelled');
    expect(onFrame).not.toHaveBeenCalled();
  });
});
