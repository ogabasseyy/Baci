import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenVerificationTrust } from './OxygenVerificationTrust';

it('identifies Oxygen as the identity verification provider', () => {
  render(<OxygenVerificationTrust />);
  expect(
    screen.getByRole('img', { name: 'Oxygen X Finance Company' })
  ).toBeVisible();
  expect(screen.getByText('Identity verification by Oxygen X')).toBeVisible();
});
