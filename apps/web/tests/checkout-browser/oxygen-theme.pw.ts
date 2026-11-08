import { expect, test } from './network';

for (const theme of ['light', 'dark'] as const) {
  test(`Oxygen dialog remains readable in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/oxygen-theme');
    const dialog = page.getByRole('dialog', { name: 'Oxygen theme fixture' });
    const heading = page.getByRole('heading', { name: 'Verify your identity' });
    const input = page.getByLabel('BVN');
    await expect(dialog).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(26, 26, 26)' : 'rgb(255, 255, 255)'
    );
    const contrast = await heading.evaluate((element) => {
      const dialog = element.closest('dialog');
      if (!dialog) throw new Error('Missing dialog');
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(
          0,
          3
        );
        const linear = rgb.map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const text = luminance(getComputedStyle(element).color);
      const surface = luminance(getComputedStyle(dialog).backgroundColor);
      return (
        (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05)
      );
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await expect(input).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(26, 26, 26)' : 'rgb(255, 255, 255)'
    );
    await expect(
      page.getByRole('img', { name: 'Oxygen X Finance Company' })
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'Oxygen X Finance Company' })
          .evaluate((image: HTMLImageElement) => image.naturalWidth)
      )
      .toBeGreaterThan(0);
  });
}
