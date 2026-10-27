import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ChatgptSetupGuide } from './setup-guide';

const reviewedImageDigests: Record<string, string> = {
  '01-pixel-setup.png':
    'b1b04b2046083a7eae625b121d055d98b67976334db0d38baa243f17f30eca56',
  '02-successful-payment.png':
    'e6073ad3eae1e197d13d995635bc2762efcdec19230cd81c88723b3e284d0909',
  '03-pixel-event.png':
    'eb263be49dc5d7660deaadb039a6f89cefaf7b4ca51ed6410d093d88d7ebcc38',
  '04-capi-event.png':
    '3c6dfbdb68598ca84689c9094386fc3ecf94d7f2b9a1eff5af3607f642c6ec8a',
  '05-create-capi-key.png':
    '6ada6699e5c35bf097b8421a17aa731954d2b660f202730f2ca235cf6f65965d',
  '06-conversion-created.png':
    '6bd26df2fbc41a1777f72ac5b13207d57c4359e5ca9f0ad8f57a9b0a7b4f4bbf',
};

it('provides a safe example screen and warns merchants to use their own credentials', () => {
  render(<ChatgptSetupGuide />);
  expect(
    screen.getByText(
      /genuine provider screens with account-specific values masked/
    )
  ).toBeInTheDocument();
  expect(
    screen.getByText(/do not copy another store’s ID/)
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Never share a screenshot of the generated key/)
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Browser events appear after a visitor grants Analytics consent/
    )
  ).toBeInTheDocument();
  const imagePaths = screen
    .getAllByRole('img')
    .map((image) => image.getAttribute('src'));
  expect(imagePaths).toEqual([
    '/guides/chatgpt-ads/01-pixel-setup.png',
    '/guides/chatgpt-ads/02-successful-payment.png',
    '/guides/chatgpt-ads/03-pixel-event.png',
    '/guides/chatgpt-ads/04-capi-event.png',
    '/guides/chatgpt-ads/05-create-capi-key.png',
  ]);
  const imageAlts = screen
    .getAllByRole('img')
    .map((image) => image.getAttribute('alt'));
  expect(new Set(imageAlts).size).toBe(imageAlts.length);
  for (const src of imagePaths) {
    expect(src).toBeTruthy();
    const assetPath = `public${src}`;
    expect(existsSync(assetPath)).toBe(true);
    const digest = createHash('sha256')
      .update(readFileSync(assetPath))
      .digest('hex');
    const filename = src?.split('/').at(-1) ?? '';
    expect(digest).toBe(reviewedImageDigests[filename]);
    expect(
      createHash('sha256')
        .update(
          readFileSync(`../../docs/guides/chatgpt-ads/screenshots/${filename}`)
        )
        .digest('hex')
    ).toBe(digest);
  }
  const docsOnlyScreenshot =
    '../../docs/guides/chatgpt-ads/screenshots/06-conversion-created.png';
  expect(existsSync(docsOnlyScreenshot)).toBe(true);
  expect(
    createHash('sha256').update(readFileSync(docsOnlyScreenshot)).digest('hex')
  ).toBe(reviewedImageDigests['06-conversion-created.png']);
  expect(
    screen.getByRole('link', {
      name: /Official conversion setup documentation/,
    })
  ).toHaveAttribute(
    'href',
    'https://developers.openai.com/ads/conversions-api'
  );
  expect(screen.getByRole('link', { name: /Event Stream/ })).toHaveAttribute(
    'href',
    'https://ads.openai.com/'
  );
  expect(
    screen.getByRole('heading', { name: 'What to verify' })
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Successful payment is sent only after Baci confirms full payment/
    )
  ).toBeInTheDocument();
});
