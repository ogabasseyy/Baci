import { describe, expect, it } from '@jest/globals';
import type { Block } from '@/types/blocks';
import { dedupeBlockIds } from './dedupe-block-ids';

const block = (id: string): Block =>
  ({ type: 'HeroCarousel', props: { id } }) as unknown as Block;

describe('dedupeBlockIds', () => {
  it('returns the input untouched when IDs are already unique', () => {
    const blocks = [block('a'), block('b')];

    expect(dedupeBlockIds(blocks)).toBe(blocks);
  });

  it('qualifies repeat occurrences while keeping the first bare', () => {
    const blocks = [block('hero'), block('grid'), block('hero')];

    const ids = dedupeBlockIds(blocks).map((entry) => entry.props.id);

    expect(ids).toEqual(['hero', 'grid', 'hero#__2']);
  });

  it('does not mutate the input blocks', () => {
    const blocks = [block('hero'), block('hero')];

    dedupeBlockIds(blocks);

    expect(blocks.map((entry) => entry.props.id)).toEqual(['hero', 'hero']);
  });
});
