import { describe, expect, it } from 'vitest';
import { isValidEvidenceLink } from './negotiation-evidence-link';

describe('negotiation evidence link', () => {
  it('accepts only http(s) evidence links', () => {
    expect(isValidEvidenceLink('https://proof.example/item')).toBe(true);
    expect(isValidEvidenceLink('http://proof.example/item')).toBe(true);
    expect(isValidEvidenceLink('ftp://proof.example/item')).toBe(false);
    expect(isValidEvidenceLink('not a url')).toBe(false);
    expect(isValidEvidenceLink('')).toBe(false);
  });
});
