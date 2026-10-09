import {
  assistanceFrameSchema,
  type SearchAssistanceFrame,
} from './assistance-frame';

/** Incremental NDJSON parser: no partial frame can become an actionable proposal. */
export function createAssistanceDecoder(
  requestId: string,
  onFrame: (frame: SearchAssistanceFrame) => void
) {
  let buffer = '';
  let sequence = 0;
  let complete = false;
  let total = 0;
  return {
    push(chunk: string) {
      if (complete && chunk.trim()) throw new Error('Data after completion');
      total += chunk.length;
      if (total > 65536) throw new Error('Response too large');
      buffer += chunk;
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.length > 8192) throw new Error('Frame too large');
        if (line.trim()) {
          if (complete) throw new Error('Data after completion');
          const frame = assistanceFrameSchema.parse(JSON.parse(line));
          if (frame.requestId !== requestId || frame.sequence !== sequence++)
            throw new Error('Stale or repeated frame');
          complete =
            frame.event.kind === 'done' || frame.event.kind === 'error';
          onFrame(frame);
        }
        end = buffer.indexOf('\n');
      }
      if (buffer.length > 8192) throw new Error('Frame too large');
    },
    finish() {
      if (buffer.trim() || !complete) throw new Error('Incomplete response');
    },
  };
}
