import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

it('mounts the local simulation and allows starting a fresh one', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await import('./main');
  expect(
    await screen.findByText(
      'Local preview · refreshing starts a new simulation'
    )
  ).toBeVisible();
  const reset = screen.getByRole('button', { name: 'Reset simulation' });
  expect(reset).toBeEnabled();
  fireEvent.click(reset);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Reset simulation' })
    ).toBeEnabled()
  );
  expect(document.getElementById('root')?.childElementCount).toBeGreaterThan(0);
});
