import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenFormProgress } from './OxygenFormProgress';

it('marks the current step and retains completed progress when advancing', () => {
  const view = render(<OxygenFormProgress step={0} />);
  const progress = screen.getByRole('list', { name: 'Application progress' });
  expect(within(progress).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('Identity').closest('li')).toHaveAttribute(
    'aria-current',
    'step'
  );
  view.rerender(<OxygenFormProgress step={1} />);
  expect(screen.getByText('Identity').closest('li')).toHaveAttribute(
    'data-state',
    'complete'
  );
  expect(screen.getByText('Bank').closest('li')).toHaveAttribute(
    'aria-current',
    'step'
  );
  expect(screen.getByText('Income').closest('li')).toHaveAttribute(
    'data-state',
    'upcoming'
  );
});
