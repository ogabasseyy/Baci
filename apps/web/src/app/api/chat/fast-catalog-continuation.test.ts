import { describe, expect, it, vi } from 'vitest';
import {
  createCompleteSearchVerifier,
  isCatalogDetailFollowUp,
  isCatalogMoreOptionsRequest,
  parseCatalogContinuation,
} from './fast-catalog-continuation';

describe('standalone catalog continuation wording', () => {
  it.each([
    'more',
    'Show me more',
    'more options?',
    'show other options',
    'Any others?',
    'What else?',
    'Could you show me more choices, please?',
  ])('recognizes a whole more-options request: %s', (text) => {
    expect(isCatalogMoreOptionsRequest(text)).toBe(true);
  });

  it.each([
    'tell me more',
    'more affordable',
    'more than 500k',
    'more storage',
    'more like iPhone 16',
    'show 1MORE earbuds',
    'show me more chargers',
    'cancel my order',
  ])('does not classify a different request as pagination: %s', (text) => {
    expect(isCatalogMoreOptionsRequest(text)).toBe(false);
  });

  it('recognizes a detail question without treating it as another page', () => {
    expect(isCatalogDetailFollowUp('Tell me more about it?')).toBe(true);
    expect(isCatalogMoreOptionsRequest('Tell me more about it?')).toBe(false);
  });

  it('preserves supported constraints attached to a more-options request', () => {
    expect(parseCatalogContinuation('Show me more under 300k')).toEqual({
      kind: 'more-results',
      refinement: 'under 300k',
    });
    expect(parseCatalogContinuation('More for gaming')).toEqual({
      kind: 'more-results',
      refinement: 'for gaming',
    });
  });

  it('requires a fresh complete search for a product named after more', () => {
    expect(parseCatalogContinuation('More Samsung phones')).toEqual({
      kind: 'more-results',
      requiresFreshSearch: true,
    });
    expect(parseCatalogContinuation('More affordable')).toBeNull();
    expect(parseCatalogContinuation('More than 500k')).toBeNull();
    expect(parseCatalogContinuation('More storage')).toBeNull();
    expect(parseCatalogContinuation('More like iPhone 16')).toBeNull();
  });

  it('handles a maximum-length punctuation-heavy continuation', () => {
    expect(parseCatalogContinuation(`more ${'?'.repeat(9_990)}X`)).toEqual({
      kind: 'more-results',
      requiresFreshSearch: true,
    });
  }, 10_000);

  it('handles multiline continuations after maximum-length whitespace', () => {
    expect(parseCatalogContinuation(`more ${' '.repeat(9_989)}X\nY`)).toEqual({
      kind: 'more-results',
      requiresFreshSearch: true,
    });
  }, 10_000);

  it('preserves multiline refinements', () => {
    expect(
      parseCatalogContinuation('Show me more under 300k\nfor gaming')
    ).toEqual({
      kind: 'more-results',
      refinement: 'under 300k\nfor gaming',
    });
  });

  it('defers a valid complete-search candidate until categories load', () => {
    const isSearch = vi.fn(() => true);
    const verifier = createCompleteSearchVerifier({
      categoriesLoaded: false,
      currencyCode: 'NGN',
      isSearch,
    });
    expect(verifier.isCompleteSearch('Phones under 300k')).toBe(false);
    expect(verifier.needsCategoryVerification()).toBe(true);
    expect(isSearch).not.toHaveBeenCalled();
  });

  it('does not defer an invalid budget or accept a rejected category-aware search', () => {
    const isSearch = vi.fn(() => false);
    const pending = createCompleteSearchVerifier({
      categoriesLoaded: false,
      currencyCode: 'NGN',
      isSearch,
    });
    expect(pending.isCompleteSearch('Phones under 500 USD')).toBe(false);
    expect(pending.needsCategoryVerification()).toBe(false);
    const loaded = createCompleteSearchVerifier({
      categoriesLoaded: true,
      currencyCode: 'NGN',
      isSearch,
    });
    expect(loaded.isCompleteSearch('Earbuds under 20k without wireless')).toBe(
      false
    );
    expect(isSearch).toHaveBeenCalledOnce();
  });
});
