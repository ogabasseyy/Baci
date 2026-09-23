import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RootDocumentStyle } from './root-document-style';

describe('RootDocumentStyle', () => {
  it('injects first-paint document CSS without a stylesheet link', () => {
    render(<RootDocumentStyle />);
    const css =
      document.querySelector('style[href="root-document"]')?.textContent ??
      document.querySelector('style')?.textContent ??
      '';

    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(css).toContain('Inter Fallback');
    expect(css).toContain('.baci-skip-link');
  });
});
