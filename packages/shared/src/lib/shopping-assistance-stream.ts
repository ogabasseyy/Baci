import { z } from 'zod';
import {
  type SearchAssistanceProposal,
  searchAssistanceProposalSchema,
} from './shopping-assistance';

const frameSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().min(1).max(80),
    sequence: z.number().int().min(0),
    event: z.discriminatedUnion('kind', [
      z
        .object({ kind: z.literal('status'), message: z.string().max(160) })
        .strict(),
      z
        .object({
          kind: z.literal('proposal'),
          proposal: searchAssistanceProposalSchema,
        })
        .strict(),
      z.object({ kind: z.literal('done') }).strict(),
      z
        .object({ kind: z.literal('error'), message: z.string().max(160) })
        .strict(),
    ]),
  })
  .strict();
export type SearchAssistanceFrame = z.infer<typeof frameSchema>;
export function encodeAssistanceFrame(frame: SearchAssistanceFrame): string {
  return `${JSON.stringify(frameSchema.parse(frame))}\n`;
}
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
          const frame = frameSchema.parse(JSON.parse(line));
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
export function describeAssistedFilters(
  proposal: SearchAssistanceProposal
): string[] {
  const filters = proposal.filters;
  return [
    ...(filters.brands ?? []),
    filters.condition === 'open_box' ? 'Open box' : filters.condition,
    filters.minPrice === undefined
      ? undefined
      : `From ₦${filters.minPrice.toLocaleString('en-NG')}`,
    filters.maxPrice === undefined
      ? undefined
      : `Up to ₦${filters.maxPrice.toLocaleString('en-NG')}`,
  ].filter((value): value is string => Boolean(value));
}
