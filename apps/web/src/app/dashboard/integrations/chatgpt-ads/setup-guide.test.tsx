import { existsSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ChatgptSetupGuide } from './setup-guide';

it('provides a safe example screen and warns merchants to use their own credentials', () => {
  render(<ChatgptSetupGuide />);
  expect(screen.getByText(/generic event setup view/)).toBeInTheDocument();
  expect(
    screen.getByText(/never copy identifiers from examples/)
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Never share a screenshot of the generated key/)
  ).toBeInTheDocument();
  expect(screen.getAllByRole('img')).toHaveLength(1);
  const image = screen.getByAltText('3. Connect the Pixel example screen');
  const src = image.getAttribute('src');
  expect(src).toBe('/guides/chatgpt-ads/03-pixel-event.png');
  expect(existsSync(`public${src}`)).toBe(true);
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
