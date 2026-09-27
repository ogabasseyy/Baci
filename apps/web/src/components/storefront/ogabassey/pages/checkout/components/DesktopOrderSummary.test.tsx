// @vitest-environment node
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss, { type AtRule, type Root, type Rule } from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DesktopOrderSummary } from './DesktopOrderSummary';

const directory = fileURLToPath(new URL('.', import.meta.url));
let compiled: Root;

function displayAtViewport(classes: string, width: number): string | undefined {
  const classSet = new Set(classes.split(/\s+/));
  let display: string | undefined;
  compiled.walkRules((rule: Rule) => {
    const selectors = rule.selector.split(',').map((selector) => selector.trim());
    const matches = [...classSet].some((name) =>
      selectors.includes(`.${name.replace(/:/g, '\\:')}`)
    );
    if (!matches) return;

    rule.walkDecls('display', (declaration) => {
      let ancestor = declaration.parent;
      while (ancestor && ancestor.type !== 'root') {
        if (ancestor.type === 'atrule' && (ancestor as AtRule).name === 'media') {
          const media = (ancestor as AtRule).params;
          const minimum = media.match(/width\s*>=\s*(\d+)rem/);
          const maximum = media.match(/width\s*<\s*(\d+)rem/);
          if (minimum && width < Number(minimum[1]) * 16) return;
          if (maximum && width >= Number(maximum[1]) * 16) return;
        }
        ancestor = ancestor.parent;
      }
      display = declaration.value;
    });
  });
  return display;
}

describe('desktop checkout summary visibility', () => {
  beforeAll(async () => {
    const from = join(directory, 'checkout-visibility.css');
    const result = await postcss([tailwind()]).process(
      '@import "tailwindcss" source(none);\n' +
        '@source inline("hidden max-lg:hidden lg:block lg:flex");\n' +
        '@layer utilities { .hidden { display: none; } }',
      { from, map: false }
    );
    compiled = postcss.parse(result.css);
  }, 20_000);

  it('keeps the summary and order action visible at desktop width even when a hidden utility loads last', () => {
    const html = renderToStaticMarkup(
      <DesktopOrderSummary
        displayItems={[]}
        formatCurrencyAuto={(amount) => `₦${amount}`}
        effectiveCheckoutCartTotal={100}
        orderTotals={null}
        deliveryCost={0}
        deliveryMethod="pickup"
        selectedQuoteId=""
        giftWrappingCost={0}
        paymentMethod="paystack"
        walletCurrencySupported={true}
        walletLoading={false}
        walletBalance={0}
        hasUser={true}
        currencySymbol="₦"
        payWithWallet={false}
        setPayWithWallet={vi.fn()}
        walletAmountUsed={0}
        remainingAmount={100}
        checkoutPayWithWallet={false}
        redvaultSummary={null}
        newsletterOptIn={false}
        setNewsletterOptIn={vi.fn()}
        handlePlaceOrder={vi.fn()}
        isProcessing={false}
        isPayForMeValid={true}
      />
    );
    const summaryClasses = html.match(/<div class="([^"]*lg:block[^"]*)"/);
    const actionClasses = html.match(/<button[^>]*class="([^"]*)"[^>]*>Place Order/);

    expect(summaryClasses).not.toBeNull();
    expect(actionClasses).not.toBeNull();
    expect(displayAtViewport(summaryClasses?.[1] ?? '', 1092)).toBe('block');
    expect(displayAtViewport(actionClasses?.[1] ?? '', 1092)).toBe('flex');
    expect(displayAtViewport(summaryClasses?.[1] ?? '', 390)).toBe('none');
    expect(displayAtViewport(actionClasses?.[1] ?? '', 390)).toBe('none');
  });
});
