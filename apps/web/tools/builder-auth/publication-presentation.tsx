import type { Locator } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortableHomeView } from '../../src/components/storefront/portable/portable-home';
import type { PortableHome } from '../../src/schemas/portable-storefront';

/** Canonical, hidden reference for presentation only; no merchant/customer data or network access. */
export function verifyPublicationPresentation(
  marker: Locator,
  config: PortableHome,
  merchantId: string
) {
  const html = renderToStaticMarkup(
    <PortableHomeView
      config={config}
      merchant={{
        id: merchantId,
        template_id: 'puck',
        slug: 'reference',
        business_name: 'Reference',
        currency: 'NGN',
      }}
      catalog={{
        merchantId,
        capturedAt: '2026-10-20T00:00:00.000Z',
        products: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            merchant_id: merchantId,
            name: 'Reference',
            price: 1,
            image: null,
            slug: 'reference',
          },
        ],
      }}
      inert={false}
    />
  );
  return marker.evaluate(
    (root, { html, types }) => {
      const actual = root.querySelector<HTMLElement>('.baci-home');
      if (!actual) return false;
      // A shadow root keeps reference CSS from repairing an incorrectly deployed stylesheet.
      // display:none prevents reference assets from loading; comparisons use computed scalar styles.
      const host = document.createElement('div');
      host.style.display = 'none';
      const shadow = host.attachShadow({ mode: 'closed' });
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const reference = parsed.querySelector<HTMLElement>('.baci-home');
      if (!reference) return false;
      shadow.append(document.importNode(reference, true));
      document.body.append(host);
      try {
        const expected = shadow.querySelector<HTMLElement>('.baci-home');
        if (!expected) return false;
        const liveStyle = getComputedStyle(actual);
        const expectedStyle = getComputedStyle(expected);
        for (const name of ['background-color', 'color', 'font-family']) {
          if (
            liveStyle.getPropertyValue(name) !==
            expectedStyle.getPropertyValue(name)
          )
            return false;
        }
        for (const name of expected.style) {
          if (
            name.startsWith('--') &&
            liveStyle.getPropertyValue(name).trim() !==
              expectedStyle.getPropertyValue(name).trim()
          )
            return false;
        }
        const liveBlocks = actual.querySelectorAll('[data-baci-block]');
        const expectedBlocks = expected.querySelectorAll('[data-baci-block]');
        for (const [i, type] of types.entries()) {
          const live = liveBlocks[i];
          const ref = expectedBlocks[i];
          if (!live || !ref) return false;
          const same = (selector: string, properties: string[]) => {
            const a = live.querySelector(selector);
            const b = ref.querySelector(selector);
            if (!a || !b) return a === null && b === null;
            const x = getComputedStyle(a);
            const y = getComputedStyle(b);
            return properties.every(
              (p) => x.getPropertyValue(p) === y.getPropertyValue(p)
            );
          };
          if (type === 'Hero') {
            if (
              !same('.baci-hero', [
                'padding-block-start',
                'padding-block-end',
                'background-image',
                'background-size',
                'background-position',
              ])
            )
              return false;
            if (
              !same('.baci-hero-content', [
                'text-align',
                'align-items',
                'gap',
                'color',
              ])
            )
              return false;
            if (!same('.baci-overlay', ['background-color', 'opacity']))
              return false;
          } else if (type === 'Text') {
            if (!same('.baci-text', ['text-align'])) return false;
          } else if (type === 'Button') {
            const a = live.querySelector('.baci-action');
            const b = ref.querySelector('.baci-action');
            if (a?.className !== b?.className) return false;
            if (!same('.baci-container', ['text-align'])) return false;
            if (
              !same('.baci-action', [
                'background-color',
                'color',
                'padding-top',
                'padding-right',
                'padding-bottom',
                'padding-left',
                'font-size',
                'border-radius',
              ])
            )
              return false;
          } else if (type === 'Header') {
            if (
              Boolean(live.querySelector('.baci-brand')) !==
              Boolean(ref.querySelector('.baci-brand'))
            )
              return false;
            if (!same('header', ['background-color', 'color'])) return false;
          } else if (type === 'Footer') {
            if (!same('footer', ['background-color', 'color'])) return false;
          } else if (type === 'ProductGrid') {
            const grid = live.querySelector('.baci-products');
            const expectedGrid = ref.querySelector('.baci-products');
            if (grid && expectedGrid) {
              const style = getComputedStyle(grid);
              if (
                style.getPropertyValue('--baci-columns').trim() !==
                  getComputedStyle(expectedGrid)
                    .getPropertyValue('--baci-columns')
                    .trim() ||
                style.display !== 'grid'
              )
                return false;
              if (
                window.innerWidth >= 768 &&
                style.gridTemplateColumns.split(/\s+/).length !==
                  Number(style.getPropertyValue('--baci-columns'))
              )
                return false;
            }
          }
        }
        return true;
      } finally {
        host.remove();
      }
    },
    { html, types: config.content.map((b) => b.type) }
  );
}
