import { existsSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ChatgptSetupGuide } from './setup-guide';

it('provides illustrated setup steps and warns merchants to use their own credentials', () => {
  render(<ChatgptSetupGuide />);
  expect(
    screen.getByText(/Use your own account’s ID and key/)
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Never share a screenshot of the generated key/)
  ).toBeInTheDocument();
  for (const title of [
    '1. Create a website data source',
    '2. Create the successful payment conversion',
    '3. Connect the Pixel',
    '4. Create a server key',
  ]) {
    const image = screen.getByAltText(title);
    const src = image.getAttribute('src');
    expect(src).toMatch(/^\/guides\/chatgpt-ads\/.+\.png$/);
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
});
