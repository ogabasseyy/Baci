/**
 * Sanitization Core Test Suite
 *
 * Tests for core sanitization functions including search query sanitization,
 * PostgREST filter injection prevention, and other XSS mitigations.
 *
 * @see https://vitest.dev/guide/
 */

import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  isValidUuid,
  sanitizeEmail,
  sanitizeFileName,
  sanitizeForLog,
  sanitizeLikePattern,
  sanitizePhone,
  sanitizePrice,
  sanitizeSearchQuery,
  sanitizeText,
  sanitizeUrl,
  stripHtmlTags,
} from '@/lib/sanitize-core';
import {
  sanitizeSchemaMarkup,
  sanitizeSchemaUrl,
} from '@/lib/sanitize-json-ld';

describe('sanitizeSearchQuery', () => {
  it('should remove basic special characters', () => {
    const result = sanitizeSearchQuery('<script>alert("xss")</script>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('"');
  });

  it('should trim and limit length', () => {
    const longQuery = 'a'.repeat(300);
    const result = sanitizeSearchQuery(longQuery);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('should remove SQL injection characters', () => {
    const result = sanitizeSearchQuery("'; DROP TABLE users; --");
    expect(result).not.toContain("'");
    expect(result).not.toContain(';');
  });

  it('should allow safe search terms', () => {
    const result = sanitizeSearchQuery('iPhone 15 Pro Max');
    expect(result).toBe('iPhone 15 Pro Max');
  });

  it('should handle empty input', () => {
    const result = sanitizeSearchQuery('');
    expect(result).toBe('');
  });

  it('should handle whitespace-only input', () => {
    const result = sanitizeSearchQuery('   ');
    expect(result).toBe('');
  });

  it('should remove PostgREST control characters', () => {
    const commaResult = sanitizeSearchQuery('apple,sku.ilike.%banana');
    expect(commaResult).not.toContain(',');
    expect(commaResult).toBe('applesku.ilike.%banana');

    const parenResult = sanitizeSearchQuery('test(group)');
    expect(parenResult).not.toContain('(');
    expect(parenResult).not.toContain(')');
    expect(parenResult).toBe('testgroup');

    const pipeResult = sanitizeSearchQuery('test|or');
    expect(pipeResult).not.toContain('|');
    expect(pipeResult).toBe('testor');
  });
});

describe('stripHtmlTags', () => {
  it('should strip basic HTML tags', () => {
    const result = stripHtmlTags('<div>Hello</div>');
    expect(result).toBe('Hello');
  });

  it('should strip nested HTML tags iteratively', () => {
    // This tests the iterative stripping to prevent <scr<script>ipt> bypass
    const result = stripHtmlTags('<scr<script>ipt>alert(1)</scr</script>ipt>');
    expect(result).not.toContain('script');
  });

  it('should handle null input', () => {
    const result = stripHtmlTags(null);
    expect(result).toBe('');
  });

  it('should handle undefined input', () => {
    const result = stripHtmlTags(undefined);
    expect(result).toBe('');
  });

  it('should return plain text unchanged (fast path)', () => {
    expect(stripHtmlTags('Hello World')).toBe('Hello World');
    expect(stripHtmlTags('  spaced text  ')).toBe('  spaced text  ');
  });

  it('should limit input length to prevent ReDoS', () => {
    const longInput = '<div>'.repeat(50000);
    const result = stripHtmlTags(longInput);
    // Should not hang and should return within max length
    expect(result.length).toBeLessThanOrEqual(100000);
  });
});

describe('sanitizeText', () => {
  it('should remove null bytes', () => {
    const result = sanitizeText('Hello\x00World');
    expect(result).not.toContain('\x00');
    expect(result).toBe('HelloWorld');
  });

  it('should strip HTML tags', () => {
    const result = sanitizeText('<b>Bold</b> text');
    expect(result).toBe('Bold text');
  });

  it('should trim whitespace', () => {
    const result = sanitizeText('  spaced  ');
    expect(result).toBe('spaced');
  });

  it('should enforce max length', () => {
    const longText = 'a'.repeat(15000);
    const result = sanitizeText(longText, 10000);
    expect(result.length).toBe(10000);
  });

  it('should handle empty string', () => {
    const result = sanitizeText('');
    expect(result).toBe('');
  });
});

describe('sanitizeEmail', () => {
  it('should lowercase and trim email', () => {
    const result = sanitizeEmail('  USER@Example.COM  ');
    expect(result).toBe('user@example.com');
  });
});

describe('sanitizePhone', () => {
  it('should keep only valid phone characters', () => {
    const result = sanitizePhone('+1 (555) 123-4567');
    expect(result).toBe('+1 (555) 123-4567');
  });

  it('should remove invalid characters', () => {
    const result = sanitizePhone('+1<script>alert(1)</script>555');
    // sanitizePhone keeps digits, +, -, spaces, and parentheses
    // The (1) from alert(1) is kept because parentheses are allowed
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).toContain('+1');
    expect(result).toContain('555');
  });
});

describe('sanitizeUrl', () => {
  it('should accept valid http URLs', () => {
    const result = sanitizeUrl('http://example.com/path');
    expect(result).toBe('http://example.com/path');
  });

  it('should accept valid https URLs', () => {
    const result = sanitizeUrl('https://example.com/path?query=1');
    expect(result).toContain('https://example.com');
  });

  it('should reject javascript: URLs', () => {
    const result = sanitizeUrl('javascript:alert(1)');
    expect(result).toBe('');
  });

  it('should reject data: URLs', () => {
    const result = sanitizeUrl('data:text/html,<script>alert(1)</script>');
    expect(result).toBe('');
  });

  it('should handle invalid URLs', () => {
    const result = sanitizeUrl('not a url');
    expect(result).toBe('');
  });
});

describe('escapeHtml', () => {
  it('should escape HTML-sensitive characters', () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).toContain('\\u003c');
    expect(result).toContain('\\u003e');
  });

  it('should escape quotes', () => {
    const result = escapeHtml('He said "Hello"');
    expect(result).toContain('\\u0022');
  });

  it('should handle empty string', () => {
    const result = escapeHtml('');
    expect(result).toBe('');
  });
});

describe('sanitizeSchemaUrl', () => {
  it('should validate and normalize URL', () => {
    const result = sanitizeSchemaUrl('https://example.com/path');
    expect(result).toBe('https://example.com/path');
  });

  it('should handle URLs with special characters', () => {
    const result = sanitizeSchemaUrl(
      'https://example.com/path?q=<tag>&ref=home'
    );
    expect(result).toBe('https://example.com/path?q=%3Ctag%3E&ref=home');
  });

  it('should reject invalid URLs', () => {
    const result = sanitizeSchemaUrl('javascript:alert(1)');
    expect(result).toBe('');
  });
});

describe('sanitizeSchemaMarkup', () => {
  it('should escape all string values in object', () => {
    const schema = {
      '@type': 'Product',
      name: '<script>alert(1)</script>Product',
      description: 'A "great" product',
    };

    const result = sanitizeSchemaMarkup(schema);
    expect(result.name).toContain('\\u003c');
    expect(result.description).toContain('\\u0022');
  });

  it('should handle nested objects', () => {
    const schema = {
      '@type': 'Product',
      offers: {
        '@type': 'Offer',
        seller: {
          name: '<b>Shop</b>',
        },
      },
    };

    const result = sanitizeSchemaMarkup(schema);
    expect(result.offers.seller.name).toContain('\\u003c');
  });

  it('should handle arrays', () => {
    const schema = {
      images: ['<img onerror=alert(1)>', 'safe-image.jpg'],
    };

    const result = sanitizeSchemaMarkup(schema);
    expect(result.images[0]).toContain('\\u003c');
    expect(result.images[1]).toBe('safe-image.jpg');
  });

  it('should pass through non-string primitives', () => {
    const schema = {
      price: 99.99,
      inStock: true,
      count: null,
    };

    const result = sanitizeSchemaMarkup(schema);
    expect(result.price).toBe(99.99);
    expect(result.inStock).toBe(true);
    expect(result.count).toBeNull();
  });
});

describe('sanitizePrice', () => {
  it('should round to 2 decimal places', () => {
    const result = sanitizePrice(99.999);
    expect(result).toBe(100);
  });

  it('should ensure non-negative', () => {
    const result = sanitizePrice(-50);
    expect(result).toBe(0);
  });

  it('should handle NaN', () => {
    const result = sanitizePrice(Number.NaN);
    expect(result).toBe(0);
  });
});

describe('sanitizeForLog', () => {
  it('should remove newlines', () => {
    const result = sanitizeForLog('Line1\nLine2\rLine3');
    expect(result).not.toContain('\n');
    expect(result).not.toContain('\r');
  });

  it('should limit length', () => {
    const longString = 'a'.repeat(500);
    const result = sanitizeForLog(longString, 200);
    expect(result.length).toBe(200);
  });

  it('should handle null/undefined', () => {
    expect(sanitizeForLog(null)).toBe('');
    expect(sanitizeForLog(undefined)).toBe('');
  });
});

describe('sanitizeLikePattern', () => {
  it('should escape SQL LIKE wildcards', () => {
    const result = sanitizeLikePattern('100%_discount');
    expect(result).toBe('100\\%\\_discount');
  });

  it('should escape backslashes', () => {
    const result = sanitizeLikePattern('path\\to\\file');
    expect(result).toBe('path\\\\to\\\\file');
  });
});

describe('isValidUuid', () => {
  it('should accept valid UUID', () => {
    expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('should reject invalid UUID', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('123e4567-e89b-12d3-a456')).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('should remove path traversal attempts', () => {
    const result = sanitizeFileName('../../../etc/passwd');
    expect(result).not.toContain('..');
  });

  it('should replace special characters with underscores', () => {
    const result = sanitizeFileName('file<script>.jpg');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('should limit length', () => {
    const longName = `${'a'.repeat(300)}.jpg`;
    const result = sanitizeFileName(longName);
    expect(result.length).toBeLessThanOrEqual(255);
  });
});
