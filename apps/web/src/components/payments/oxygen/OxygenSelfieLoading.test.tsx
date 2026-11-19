import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenSelfieLoading } from './OxygenSelfieLoading';

it('distinguishes opening the camera from awaiting provider confirmation', () => {
  const view = render(<OxygenSelfieLoading confirming={false} />);
  expect(
    screen.getByRole('status', { name: 'Opening face verification' })
  ).toHaveAttribute('aria-busy', 'true');
  view.rerender(<OxygenSelfieLoading confirming />);
  expect(
    screen.getByRole('status', { name: 'Confirming your selfie' })
  ).toHaveTextContent('waiting for Oxygen');
});
