import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StorefrontSpeculationRules } from './storefront-speculation-rules';

function readSpeculationScript(container: HTMLElement): {
  raw: string;
  json: { prerender: unknown[]; prefetch: unknown[] };
} {
  const script = container.ownerDocument.head.querySelector(
    'script[type="speculationrules"]'
  ) as HTMLScriptElement | null;
  if (!script) {
    throw new Error('speculationrules script not rendered');
  }
  const raw = script.textContent ?? '';
  return { raw, json: JSON.parse(raw) };
}

describe('StorefrontSpeculationRules', () => {
  afterEach(() => {
    document.head
      .querySelectorAll('script[type="speculationrules"]')
      .forEach((script) => script.remove());
  });

  it('registers a fresh script outside the streamed React subtree and cleans it up', () => {
    const { container, rerender, unmount } = render(
      <StorefrontSpeculationRules basePath="" />
    );
    expect(container.querySelector('script')).toBeNull();
    const first = document.head.querySelector('script[type="speculationrules"]');
    expect(first).not.toBeNull();
    rerender(<StorefrontSpeculationRules basePath="/shop" />);
    expect(first?.isConnected).toBe(false);
    expect(
      document.head.querySelectorAll('script[type="speculationrules"]')
    ).toHaveLength(1);
    unmount();
    expect(
      document.head.querySelector('script[type="speculationrules"]')
    ).toBeNull();
  });
  it('emits a speculationrules script with prerender and prefetch rules', () => {
    // Arrange & Act
    const { container } = render(<StorefrontSpeculationRules basePath="" />);
    const { json } = readSpeculationScript(container);

    // Assert
    expect(Array.isArray(json.prerender)).toBe(true);
    expect(Array.isArray(json.prefetch)).toBe(true);
    expect(json.prerender).toHaveLength(1);
    expect(json.prefetch).toHaveLength(1);
  });

  it('serializes safely so the JSON cannot break out of the script element', () => {
    // Arrange & Act
    const { container } = render(<StorefrontSpeculationRules basePath="" />);
    const { raw, json } = readSpeculationScript(container);

    // Assert — no literal "</script>" or unescaped "<" in the emitted text,
    // yet it still round-trips through JSON.parse.
    expect(raw).not.toContain('</script>');
    expect(raw).not.toContain('<');
    expect(json.prerender).toHaveLength(1);
  });

  it('scopes patterns to the routing base path', () => {
    // Arrange & Act
    const { container } = render(
      <StorefrontSpeculationRules basePath="/ogabassey" />
    );
    const { raw } = readSpeculationScript(container);

    // Assert
    expect(raw).toContain('/ogabassey/:category/:product');
    expect(raw).toContain('/ogabassey/:category');
  });
});
