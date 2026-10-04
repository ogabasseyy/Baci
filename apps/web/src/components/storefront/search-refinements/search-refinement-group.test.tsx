import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RefinementGroup } from './search-refinement-group';

it('renders an always-open group without a toggle', () => {
  render(
    <RefinementGroup group="rating" title="Rating" open>
      <span>Body</span>
    </RefinementGroup>
  );
  expect(screen.getByText('Rating')).toBeInTheDocument();
  expect(screen.getByText('Body')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

it('toggles a collapsible group through its button', () => {
  const onToggle = vi.fn();
  const view = render(
    <RefinementGroup
      group="brand"
      title="Brand"
      open={false}
      onToggle={onToggle}
    >
      <span>Body</span>
    </RefinementGroup>
  );
  const toggle = screen.getByRole('button', { name: /Brand/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Body')).toBeNull();
  fireEvent.click(toggle);
  expect(onToggle).toHaveBeenCalledTimes(1);
  view.rerender(
    <RefinementGroup group="brand" title="Brand" open onToggle={onToggle}>
      <span>Body</span>
    </RefinementGroup>
  );
  expect(screen.getByRole('button', { name: /Brand/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  expect(screen.getByText('Body')).toBeInTheDocument();
});
