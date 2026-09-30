import { describe, expect, it } from 'vitest';
import { matchesModelSpecTokens, type ModelSpecScope } from './matches-discovery-product-intent-model-spec';

function makeScope(
  coreWords: string[],
  productSpecWords: string[],
  identityWords: string[] = ['laptop'],
  itemWords: string[] = ['laptop'],
): ModelSpecScope {
  return {
    coreWords,
    hasAlternativeItemTypes: false,
    identityWords,
    itemText: identityWords,
    itemType: itemWords[0],
    itemWords,
    matchedBranchPhrases: [],
    productSpecWords,
  };
}

describe('matchesModelSpecTokens', () => {
  it.each([
    ['16gb', '16gb'],
    ['1tb', '1tb'],
    ['512mb', '512mb'],
    ['5000mah', '5000mah'],
    ['20w', '20w'],
    ['120hz', '120hz'],
    ['12mp', '12mp'],
  ])('requires an exact match for %s without a lower-bound operator', (requested, exact) => {
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', requested],
      ['laptop', exact],
    ))).toBe(true);
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', requested],
      ['laptop', '1w'],
    ))).toBe(false);
  });

  it.each([
    ['20w', '30w', '15w', '30hz'],
    ['120hz', '144hz', '60hz', '120w'],
    ['5000mah', '6000mah', '4000mah', '6000w'],
    ['12mp', '16mp', '8mp', '16hz'],
  ])('compares at-least %s only with compatible units', (requested, larger, smaller, incompatible) => {
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', 'at', 'least', requested],
      ['laptop', larger],
    ))).toBe(true);
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', 'at', 'least', requested],
      ['laptop', smaller],
    ))).toBe(false);
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', 'at', 'least', requested],
      ['laptop', incompatible],
    ))).toBe(false);
  });

  it('compares memory units by amount while retaining the requested RAM context', () => {
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', 'at', 'least', '16gb', 'ram'],
      ['laptop', '1tb', 'ram'],
    ))).toBe(true);
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', 'at', 'least', '16gb', 'ram'],
      ['laptop', '16gb', 'ssd'],
    ))).toBe(false);
  });

  it('requires exact specifications when the query has no lower-bound operator', () => {
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', '20w'],
      ['laptop', '20w'],
    ))).toBe(true);
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', '20w'],
      ['laptop', '30w'],
    ))).toBe(false);
  });

  it('requires requested model qualifiers on the same model-number occurrence', () => {
    expect(matchesModelSpecTokens(makeScope(
      ['iphone', '15', 'pro'],
      ['iphone', '15', 'pro'],
      ['iphone', '15', 'pro'],
      ['iphone', '15', 'pro'],
    ))).toBe(true);
    expect(matchesModelSpecTokens(makeScope(
      ['iphone', '15', 'pro'],
      ['iphone', '15', 'pro', 'max'],
      ['iphone', '15', 'pro', 'max'],
      ['iphone', '15', 'pro'],
    ))).toBe(false);
    expect(matchesModelSpecTokens(makeScope(
      ['iphone', '15', 'pro'],
      ['iphone', '14', 'pro'],
      ['iphone', '14', 'pro'],
      ['iphone', '15', 'pro'],
    ))).toBe(false);
  });

  it('accepts a matching unqualified model occurrence after an incompatible qualified mention', () => {
    expect(matchesModelSpecTokens(makeScope(
      ['iphone', '15'],
      ['iphone', '15', 'pro', 'and', 'iphone', '15'],
      ['iphone', '15', 'pro', 'and', 'iphone', '15'],
      ['iphone', '15'],
    ))).toBe(true);
  });
  it.each(['6000mah', '16mp'])('does not borrow RAM context belonging to a preceding %s specification', (priorSpec) => {
    expect(matchesModelSpecTokens(makeScope(
      ['laptop', 'with', 'at', 'least', '16gb', 'ram'],
      ['laptop', priorSpec, 'ram', '32gb'],
    ))).toBe(false);
  });

});
