import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenVerificationTrust } from './OxygenVerificationTrust';

it('identifies Oxygen as the identity verification provider', () => {
  render(<OxygenVerificationTrust />);
  const logo = screen.getByRole('img', { name: 'Oxygen X Finance Company' });
  expect(logo).toBeVisible();
  expect(logo.getAttribute('src')).not.toContain('%2Fpartners%2Foxygen-x.png');
  expect(screen.getByText('Identity verification by Oxygen X')).toBeVisible();
});
