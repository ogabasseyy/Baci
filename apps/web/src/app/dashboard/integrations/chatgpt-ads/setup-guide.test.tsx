import { existsSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ChatgptSetupGuide } from './setup-guide';

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
  for (const src of imagePaths) {
    expect(src).toBeTruthy();
    expect(existsSync(`public${src}`)).toBe(true);
  }
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
