import type { SearchAssistanceFrame } from './assistance-frame';
import { createAssistanceDecoder } from './assistance-stream-decoder';

export async function readAssistanceStream(
  response: Response,
  requestId: string,
  signal: AbortSignal,
  onFrame: (frame: SearchAssistanceFrame) => void
): Promise<void> {
  if (!response.ok || !response.body) throw new Error('Assistance unavailable');
  const parser = createAssistanceDecoder(requestId, onFrame);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('Cancelled');
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    if (signal.aborted) throw new Error('Cancelled');
    parser.push(decoder.decode());
    parser.finish();
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
