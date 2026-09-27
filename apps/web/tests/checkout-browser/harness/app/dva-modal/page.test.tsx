import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import DvaModalPage from './page';

it('composes the merchant and checkout theme providers for the DVA fixture', async () => {
  render(<DvaModalPage />);

  await waitFor(() => {
    expect(
      document.documentElement.style.getPropertyValue('--store-primary')
    ).toBe('#6941c6');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open DVA modal' }));

  expect(screen.getByRole('heading', { name: 'Bank Transfer' })).toBeVisible();
  expect(screen.getByText('₦750')).toBeVisible();
});
