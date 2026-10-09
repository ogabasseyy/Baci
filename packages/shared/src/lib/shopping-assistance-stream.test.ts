import { describe, expect, it } from 'vitest';
import { parseSearchAssistanceProposal } from './parse-search-assistance-proposal';
import {
  createAssistanceDecoder,
  describeAssistedFilters,
  encodeAssistanceFrame,
  readAssistanceStream,
  type SearchAssistanceFrame,
} from './shopping-assistance-stream';

describe('shopping-assistance-stream barrel', () => {
  it('re-exports the frame codec, decoder, reader, and filter labels', () => {
    const frames: SearchAssistanceFrame[] = [];
    const parser = createAssistanceDecoder('r1', (frame) => frames.push(frame));
    parser.push(
      encodeAssistanceFrame({
        version: 1,
        requestId: 'r1',
        sequence: 0,
        event: { kind: 'done' },
      })
    );
    parser.finish();
    expect(frames).toHaveLength(1);
    expect(typeof readAssistanceStream).toBe('function');
    expect(
      describeAssistedFilters(
        parseSearchAssistanceProposal({
          query: 'iphone',
          explanation: 'Used phones.',
          filters: { brands: ['Apple'] },
        })
      )
    ).toEqual(['Apple']);
  });
});
