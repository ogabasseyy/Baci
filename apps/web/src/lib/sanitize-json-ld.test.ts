import { describe, expect, it } from 'vitest';
import {
  safeJsonLdStringify,
  sanitizeSchemaMarkup,
  sanitizeSchemaUrl,
} from './sanitize-json-ld';

describe('sanitizeSchemaUrl', () => {
  it('returns sanitized URL for valid https URL', () => {
    const result = sanitizeSchemaUrl('https://example.com/product');
    expect(result).toBe('https://example.com/product');
  });

  it('preserves URL data characters after validation', () => {
    const result = sanitizeSchemaUrl('https://example.com/a&b%3Cc');
    expect(result).toBe('https://example.com/a&b%3Cc');
  });

  it('returns empty string for invalid URLs', () => {
    const result = sanitizeSchemaUrl('javascript:alert(1)');
    expect(result).toBe('');
  });
});

describe('sanitizeSchemaMarkup', () => {
  it('returns null/undefined unchanged', () => {
    expect(sanitizeSchemaMarkup(null)).toBeNull();
    expect(sanitizeSchemaMarkup(undefined)).toBeUndefined();
  });

  it('escapes HTML in strings', () => {
    expect(sanitizeSchemaMarkup('<script>alert(1)</script>')).toBe(
      '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e'
    );
  });

  it('passes numbers through unchanged', () => {
    expect(sanitizeSchemaMarkup(42)).toBe(42);
  });

  it('passes booleans through unchanged', () => {
    expect(sanitizeSchemaMarkup(true)).toBe(true);
  });

  it('recursively sanitizes arrays', () => {
    const result = sanitizeSchemaMarkup(['<b>bold</b>', 'safe']);
    expect(result).toEqual(['\\u003cb\\u003ebold\\u003c/b\\u003e', 'safe']);
  });

  it('recursively sanitizes object values', () => {
    const result = sanitizeSchemaMarkup({
      name: '<img src=x onerror=alert(1)>',
      price: 100,
    });
    expect(result.name).toContain('\\u003cimg');
    expect(result.price).toBe(100);
  });

  it('handles nested objects', () => {
    const result = sanitizeSchemaMarkup({
      offer: { price: '<script>', currency: 'NGN' },
    });
    expect(result.offer.price).toBe('\\u003cscript\\u003e');
    expect(result.offer.currency).toBe('NGN');
  });

  it('repairs a lone high surrogate in property names', () => {
    const key = `high-${String.fromCharCode(0xd83e)}`;

    expect(sanitizeSchemaMarkup({ [key]: 'value' })).toEqual({
      'high-�': 'value',
    });
  });

  it('repairs a lone low surrogate in property names', () => {
    const key = `low-${String.fromCharCode(0xdd1e)}`;

    expect(sanitizeSchemaMarkup({ [key]: 'value' })).toEqual({
      'low-�': 'value',
    });
  });

  it('preserves an own __proto__ property in both sanitization paths', () => {
    const schema = JSON.parse('{"__proto__":"value"}');
    const sanitized = sanitizeSchemaMarkup(schema);
    const serialized = JSON.parse(safeJsonLdStringify(schema));

    expect(Object.hasOwn(sanitized, '__proto__')).toBe(true);
    expect(Object.entries(sanitized)).toContainEqual(['__proto__', 'value']);
    expect(Object.entries(serialized)).toContainEqual(['__proto__', 'value']);
  });
});

describe('safeJsonLdStringify', () => {
  it('returns script-safe JSON without changing parsed data values', () => {
    const schema = {
      '@type': 'Product',
      name: 'Test <b>Product</b>',
      url: 'https://example.com/products/test?source=web&variantId=123',
      line: 'one\u2028two\u2029three',
      price: 5000,
    };
    const result = safeJsonLdStringify(schema);
    const parsed = JSON.parse(result);
    expect(result).toContain('\\u003c');
    expect(result).toContain('\\u0026');
    expect(result).toContain('\\u2028');
    expect(result).toContain('\\u2029');
    expect(parsed.name).toBe('Test <b>Product</b>');
    expect(parsed.url).toBe(
      'https://example.com/products/test?source=web&variantId=123'
    );
    expect(parsed.line).toBe('one\u2028two\u2029three');
    expect(parsed.price).toBe(5000);
  });

  it('replaces a truncated surrogate without changing valid emoji', () => {
    const truncatedEmoji = `broken ${String.fromCharCode(0xd83e)}...`;
    const schema = {
      description: truncatedEmoji,
      name: '🧩 Upgradeable laptop',
    };

    const result = safeJsonLdStringify(schema);

    expect(JSON.parse(result)).toMatchObject({
      description: 'broken �...',
      name: '🧩 Upgradeable laptop',
    });
    expect(result).not.toContain('\\ud83e');
  });

  it('replaces a lone low surrogate', () => {
    const schema = {
      description: `broken ${String.fromCharCode(0xdd1e)}...`,
    };

    const result = safeJsonLdStringify(schema);

    expect(JSON.parse(result)).toMatchObject({
      description: 'broken �...',
    });
    expect(result).not.toContain('\\udd1e');
  });

  it('repairs a lone high surrogate in property names', () => {
    const key = `high-${String.fromCharCode(0xd83e)}`;
    const result = safeJsonLdStringify({ [key]: 'value' });

    expect(JSON.parse(result)).toEqual({ 'high-�': 'value' });
    expect(result).not.toContain('\\ud83e');
  });

  it('repairs a lone low surrogate in property names', () => {
    const key = `low-${String.fromCharCode(0xdd1e)}`;
    const result = safeJsonLdStringify({ [key]: 'value' });

    expect(JSON.parse(result)).toEqual({ 'low-�': 'value' });
    expect(result).not.toContain('\\udd1e');
  });

  it('returns an empty string for an undefined schema', () => {
    expect(safeJsonLdStringify(undefined)).toBe('');
  });
});
