import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { GiglLocationNotice } from './GiglLocationNotice';

it('explains the GIG confirmation dependency without offering an ineffective rate retry', () => {
  render(<GiglLocationNotice />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'GIG delivery cannot be confirmed now'
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'another available delivery method'
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
