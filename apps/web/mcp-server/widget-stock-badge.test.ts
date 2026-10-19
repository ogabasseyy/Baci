import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'server.ts'), 'utf8');
const start = source.indexOf('    const renderProducts =');
const end = source.indexOf('    const renderOrder =', start);

function renderCard(inStock: boolean | null | undefined): string {
  const cards: { innerHTML: string; className: string; querySelector: () => null }[] = [];
  const context = {
    products: [{ id: 'product', name: 'Charger', price: 10000, in_stock: inStock }],
    document: {
      createElement: () => {
        const card = { innerHTML: '', className: '', querySelector: () => null };
        cards.push(card);
        return card;
      },
      getElementById: () => null,
    },
    contentEl: { innerHTML: '', querySelector: () => ({ appendChild: () => {} }) },
    escapeHtml: (value: unknown) => String(value ?? ''),
    formatPrice: (value: number) => String(value),
  };
  runInNewContext(`${source.slice(start, end)}\nrenderProducts(products);`, context);
  return cards[0].innerHTML;
}

describe('product card stock badges', () => {
  it.each([null, undefined])('omits an unknown-stock badge for %s', (value) => {
    const html = renderCard(value);
    expect(html).not.toContain('Confirm availability');
    expect(html).not.toContain('class="in-stock"');
    expect(html).toContain('Charger');
    expect(html).toContain('btn-cart');
  });

  it.each([[true, 'In Stock'], [false, 'Out of Stock']] as const)(
    'keeps confirmed stock state %s visible',
    (value, label) => expect(renderCard(value)).toContain(label)
  );
});
