import { describe, expect, it } from 'vitest';
import { ROOT_DOCUMENT_CSS } from './root-document-css';

describe('ROOT_DOCUMENT_CSS', () => {
  it('defines Inter Fallback locally without a webfont @font-face', () => {
    expect(ROOT_DOCUMENT_CSS).toContain('font-family: "Inter Fallback"');
    expect(ROOT_DOCUMENT_CSS).toContain('src: local(Arial)');
    expect(ROOT_DOCUMENT_CSS).toContain('--font-sans:');
    expect(ROOT_DOCUMENT_CSS).toContain('@layer base');
    expect(ROOT_DOCUMENT_CSS).not.toContain('Inter Naira');
    expect(ROOT_DOCUMENT_CSS).not.toContain('--font-naira');
    expect(ROOT_DOCUMENT_CSS).not.toMatch(/font-display:\s*swap/);
    expect(ROOT_DOCUMENT_CSS).not.toMatch(/url\([^)]+\.woff2\)/);
  });

  it('keeps skip-link clipping on first paint', () => {
    expect(ROOT_DOCUMENT_CSS).toContain('.baci-skip-link');
    expect(ROOT_DOCUMENT_CSS).toContain('clip-path: inset(50%)');
  });
});
