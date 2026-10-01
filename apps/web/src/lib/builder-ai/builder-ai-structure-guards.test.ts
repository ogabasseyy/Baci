import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import {
  getBuilderAiStructuralBaseline,
  getBuilderAiStructuralFailure,
  validateBuilderAiCandidate,
} from './builder-ai-structure-guards';

const text = (id: string) => ({ props: { id }, type: 'Text' });

describe('getBuilderAiStructuralFailure', () => {
  it('ignores preserved zone arrays that are not renderable component lists', () => {
    const config = {
      content: [text('one')],
      root: { title: 'Home' },
      zones: { legacy: [null] },
    } as BuilderData;
    const baseline = getBuilderAiStructuralBaseline(config);

    expect(getBuilderAiStructuralFailure(config, baseline)).toBeUndefined();
  });

  it('preserves structural counts, catalog availability, and the block budget', () => {
    const oneBlockBaseline = getBuilderAiStructuralBaseline([text('one')]);
    expect(
      getBuilderAiStructuralFailure([text('one')], oneBlockBaseline)
    ).toBeUndefined();
    expect(
      getBuilderAiStructuralFailure([text('one')], {
        ...oneBlockBaseline,
        headers: 1,
      })
    ).toBe('Protected component cardinality changed');
    expect(
      getBuilderAiStructuralFailure([text('one')], {
        ...oneBlockBaseline,
        requiresProductGrid: true,
      })
    ).toBe('A storefront requires one ProductGrid');
    expect(
      getBuilderAiStructuralFailure(
        Array.from({ length: 501 }, (_, index) => text(String(index))),
        getBuilderAiStructuralBaseline(
          Array.from({ length: 501 }, (_, index) => text(String(index)))
        )
      )
    ).toBe('Builder document has too many blocks');
  });

  it('rejects a component moved between collections with different anchor regions', () => {
    const current = {
      content: [{ props: { id: 'root-header' }, type: 'Header' }],
      root: { title: 'Home' },
      zones: {
        aside: [
          { props: { id: 'zone-text' }, type: 'Text' },
          { props: { id: 'zone-header' }, type: 'Header' },
        ],
      },
    } as BuilderData;
    const baseline = getBuilderAiStructuralBaseline(current);
    const candidate = {
      ...current,
      content: [
        { props: { id: 'root-header' }, type: 'Header' },
        { props: { id: 'zone-text' }, type: 'Text' },
      ],
      zones: { aside: [{ props: { id: 'zone-header' }, type: 'Header' }] },
    } as BuilderData;

    expect(getBuilderAiStructuralFailure(candidate, baseline)).toBe(
      'Component moved across a protected anchor'
    );
  });

  it('allows a cross-zone move when neither collection has a protected anchor', () => {
    const current = {
      content: [text('root-text')],
      root: { title: 'Home' },
      zones: { aside: [text('zone-text')] },
    } satisfies BuilderData;
    const candidate = {
      ...current,
      content: [text('zone-text')],
      zones: { aside: [text('root-text')] },
    } satisfies BuilderData;

    expect(
      getBuilderAiStructuralFailure(
        candidate,
        getBuilderAiStructuralBaseline(current)
      )
    ).toBeUndefined();
  });

  it('rejects a final candidate with an id duplicated between content and a zone', () => {
    const candidate = {
      content: [text('shared-id')],
      root: { title: 'Home' },
      zones: { aside: [text('shared-id')] },
    } satisfies BuilderData;

    expect(
      validateBuilderAiCandidate(
        candidate,
        getBuilderAiStructuralBaseline(candidate)
      )
    ).toEqual({ failure: 'Duplicate component id' });
  });
});
