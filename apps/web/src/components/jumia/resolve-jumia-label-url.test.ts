import { describe, expect, it } from 'vitest';
import { resolveJumiaLabelUrl } from './resolve-jumia-label-url';

describe('resolveJumiaLabelUrl', () => {
  it('returns http(s) label URLs unchanged', () => {
    expect(resolveJumiaLabelUrl('https://cdn.example.com/label.pdf')).toBe(
      'https://cdn.example.com/label.pdf'
    );
  });

  it('converts base64 PDF content into a printable data URL', () => {
    expect(resolveJumiaLabelUrl('UERG')).toBe(
      'data:application/pdf;base64,UERG'
    );
  });

  it('rejects provider-controlled non-PDF data URLs', () => {
    expect(resolveJumiaLabelUrl('data:text/html;base64,PGh0bWw+')).toBeNull();
    expect(resolveJumiaLabelUrl('data:application/pdf,not-base64')).toBeNull();
  });

  it('preserves valid PDF data URLs', () => {
    expect(resolveJumiaLabelUrl('data:application/pdf;base64,UERG')).toBe(
      'data:application/pdf;base64,UERG'
    );
  });

  it('rejects non-base64 non-URL labels', () => {
    expect(resolveJumiaLabelUrl('not a label!!!')).toBeNull();
    expect(resolveJumiaLabelUrl(undefined)).toBeNull();
  });
});
