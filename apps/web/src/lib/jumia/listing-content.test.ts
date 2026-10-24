import { describe, expect, it } from 'vitest';
import { prepareJumiaListingContent } from './listing-content';

const facts = {
  title: 'A factual product title',
  description: 'A supplied factual description.',
  bullets: ['First fact', 'Second fact', 'Third fact', 'Fourth fact'],
  providerClassification: 'unknown',
  weight: { value: 250, unit: 'g' },
};

describe('pure Jumia listing content preparation', () => {
  it('prepares escaped content and known-unit weight without changing supplied facts', () => {
    const input = {
      ...facts,
      title: 'A <b>product</b> & name',
      description: '<script>alert(1)</script> & facts',
      bullets: ['<img src=x onerror=alert(1)>', 'A & B', 'Third', 'Fourth'],
    };
    const result = prepareJumiaListingContent(input);
    expect(result).toEqual({
      success: true,
      content: {
        name: { value: 'A <b>product</b> & name' },
        description: {
          value: '&lt;script&gt;alert(1)&lt;/script&gt; &amp; facts',
        },
        shortDescriptionHtml:
          '<ul><li>&lt;img src=x onerror=alert(1)&gt;</li><li>A &amp; B</li><li>Third</li><li>Fourth</li></ul>',
        productWeightKg: 0.25,
      },
      classificationBoundary: 'provider-classification-required',
    });
    expect(input.description).toBe('<script>alert(1)</script> & facts');
    expect(input.bullets[0]).toBe('<img src=x onerror=alert(1)>');
  });

  it.each([15, 60])('accepts a title of exactly %s characters', (length) => {
    expect(
      prepareJumiaListingContent({ ...facts, title: 'x'.repeat(length) })
        .success
    ).toBe(true);
  });
  it.each([
    0, 14, 61, 70,
  ])('rejects a title of %s characters without truncation', (length) => {
    expect(
      prepareJumiaListingContent({ ...facts, title: 'x'.repeat(length) })
    ).toMatchObject({
      success: false,
      errors: [{ field: 'title' }],
    });
  });

  it('keeps byte-exact plain-text whitespace and escapes literal entities without interpreting HTML', () => {
    const result = prepareJumiaListingContent({
      ...facts,
      description: '  A &lt; B  ',
      bullets: ['  A  ', 'B', 'C', 'D'],
    });
    expect(result).toMatchObject({
      success: true,
      content: {
        description: { value: '  A &amp;lt; B  ' },
        shortDescriptionHtml:
          '<ul><li>  A  </li><li>B</li><li>C</li><li>D</li></ul>',
      },
    });
  });

  it('uses seven bullets only for explicitly supplied provider 3C classification', () => {
    expect(
      prepareJumiaListingContent({ ...facts, providerClassification: 'non-3c' })
    ).toMatchObject({
      success: true,
      classificationBoundary: 'explicit-provider-classification',
    });
    expect(
      prepareJumiaListingContent({ ...facts, providerClassification: '3c' })
    ).toMatchObject({ success: false, errors: [{ field: 'bullets' }] });
    expect(
      prepareJumiaListingContent({
        ...facts,
        providerClassification: '3c',
        bullets: ['1', '2', '3', '4', '5', '6', '7'],
      })
    ).toMatchObject({
      success: true,
      classificationBoundary: 'explicit-provider-classification',
    });
    expect(
      prepareJumiaListingContent({
        ...facts,
        providerClassification: undefined,
      })
    ).toMatchObject({
      success: true,
      classificationBoundary: 'provider-classification-required',
    });
    expect(
      prepareJumiaListingContent({ ...facts, providerClassification: 'Gaming' })
    ).toMatchObject({
      success: false,
      errors: [{ field: 'providerClassification' }],
    });
  });

  it('reports every invalid entry and missing fact deterministically, with no partial content', () => {
    const result = prepareJumiaListingContent({
      title: ' ',
      description: ' ',
      bullets: ['one', ' ', 7],
      weight: { value: 0 },
    });
    expect(result).toMatchObject({ success: false });
    if (result.success) throw new Error('Invalid content must fail');
    expect(result.errors.map((error) => error.field)).toEqual([
      'title',
      'description',
      'bullets',
      'bullets.1',
      'bullets.2',
      'weight.value',
      'weight.unit',
    ]);
    expect(result).not.toHaveProperty('content');
  });

  it.each([
    undefined,
    null,
    { value: 1 },
    { value: '1', unit: 'kg' },
    { value: 0, unit: 'kg' },
    { value: -1, unit: 'kg' },
    { value: Number.NaN, unit: 'kg' },
    { value: Number.POSITIVE_INFINITY, unit: 'kg' },
    { value: 1, unit: 'lb' },
    { value: Number.MIN_VALUE, unit: 'g' },
  ])('rejects unknown, invalid or unrepresentable weight %j', (weight) => {
    expect(prepareJumiaListingContent({ ...facts, weight }).success).toBe(
      false
    );
  });
  it.each([
    { value: 1.25, unit: 'kg' },
    { value: 1250, unit: 'g' },
  ])('converts only explicit g/kg units %j', (weight) => {
    expect(prepareJumiaListingContent({ ...facts, weight })).toMatchObject({
      success: true,
      content: { productWeightKg: 1.25 },
    });
  });
  it.each([
    null,
    [],
    Object.create(facts),
  ])('rejects non-record or inherited facts', (input) => {
    expect(prepareJumiaListingContent(input).success).toBe(false);
  });
  it('does not invent missing descriptions, bullets, weights or metadata facts', () => {
    const result = prepareJumiaListingContent({ title: facts.title });
    expect(result).toMatchObject({ success: false });
    if (result.success) throw new Error('Missing facts must fail');
    expect(result.errors.map((error) => error.field)).toEqual([
      'description',
      'bullets',
      'weight.value',
      'weight.unit',
    ]);
  });
  it('rejects accessor-based facts without executing them', () => {
    const input = { ...facts };
    Object.defineProperty(input, 'title', {
      get: () => {
        throw new Error('Accessor must not execute');
      },
      enumerable: true,
    });
    expect(prepareJumiaListingContent(input).success).toBe(false);
  });
  it('reports a sparse bullet index without rejecting the four valid bullets', () => {
    const bullets = ['A', 'B', 'C', 'D', 'E'];
    Reflect.deleteProperty(bullets, 1);
    const result = prepareJumiaListingContent({ ...facts, bullets });
    if (result.success) throw new Error('Sparse bullets must fail');
    expect(result.errors.map((error) => error.field)).toEqual(['bullets.1']);
  });
  it('reports an accessor bullet index without executing its getter', () => {
    const bullets = ['A', 'B', 'C', 'D', 'E'];
    let reads = 0;
    Object.defineProperty(bullets, 1, {
      get: () => {
        reads++;
        return 'B';
      },
      enumerable: true,
      configurable: true,
    });
    const result = prepareJumiaListingContent({ ...facts, bullets });
    if (result.success) throw new Error('Accessor bullets must fail');
    expect(result.errors.map((error) => error.field)).toEqual(['bullets.1']);
    expect(reads).toBe(0);
  });
  it.each([
    'Factual product A & B',
    'Factual product &amp; B',
    'Factual <b>product</b>',
  ])('preserves raw JSON title bytes without assuming HTML entity decoding: %s', (title) => {
    expect(prepareJumiaListingContent({ ...facts, title })).toMatchObject({
      success: true,
      content: { name: { value: title } },
    });
  });
});
