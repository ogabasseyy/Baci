import type { Locator } from '@playwright/test';
import { expect, test } from './network';

function luminance(rgb: string) {
  const channels = rgb.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported computed color: ${rgb}`);
  }
  const linear = channels.slice(0, 3).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

async function contrastRatio(foreground: Locator) {
  const colors = await foreground.evaluate((element) => {
    const surface = element.closest('main, article, span, p') ?? element;
    return {
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(surface).backgroundColor,
    };
  });
  const values = [
    luminance(colors.foreground),
    luminance(colors.background),
  ].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const themes = [
  {
    name: 'light',
    variables: `
      --store-background: #ffffff !important;
      --store-background-text: #111827 !important;
      --store-surface: #ffffff !important;
      --ogabassey-surface: #ffffff !important;
      --ogabassey-surface-text: #111827 !important;
      --store-option-secondary: #f3f4f6 !important;
      --store-secondary-text: #111827 !important;
    `,
  },
  {
    name: 'dark',
    variables: `
      --store-background: #0a0a0a !important;
      --store-background-text: #f9fafb !important;
      --store-surface: #1a1a1a !important;
      --ogabassey-surface: #1a1a1a !important;
      --ogabassey-surface-text: #f9fafb !important;
      --store-option-secondary: #262626 !important;
      --store-secondary-text: #ffffff !important;
    `,
  },
];

for (const theme of themes) {
  test(`unlock-order text meets contrast in ${theme.name} theme`, async ({
    page,
  }) => {
    await page.goto('/unlock-orders');
    await page.addStyleTag({
      content: `:root { ${theme.variables} }`,
    });

    const mainHeading = page.getByRole('heading', {
      level: 1,
      name: 'Unlock orders',
    });
    await expect(mainHeading).toBeVisible();
    expect(await contrastRatio(mainHeading)).toBeGreaterThanOrEqual(4.5);

    const card = page.locator('article');
    const orderHeading = card.getByRole('heading', {
      name: 'iPhone 17 Pro Max',
    });
    await expect(orderHeading).toBeVisible();
    expect(await contrastRatio(orderHeading)).toBeGreaterThanOrEqual(4.5);

    const status = page.getByText('In Progress', { exact: true });
    expect(await contrastRatio(status)).toBeGreaterThanOrEqual(4.5);

    const customerMessage = page.getByText(
      'The carrier is processing your request.'
    );
    expect(await contrastRatio(customerMessage)).toBeGreaterThanOrEqual(4.5);
  });
}
