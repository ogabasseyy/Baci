import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenSignatureControls } from './OxygenSignatureControls';

it('exposes clear and expansion actions only in their applicable states', () => {
  const clear = vi.fn();
  const toggle = vi.fn();
  const view = render(
    <OxygenSignatureControls
      expanded={false}
      showClear={false}
      onClear={clear}
      onToggle={toggle}
    />
  );
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand signing area' }));
  expect(toggle).toHaveBeenCalledOnce();
  view.rerender(
    <OxygenSignatureControls
      expanded
      showClear
      onClear={clear}
      onToggle={toggle}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Reduce signing area' })
  ).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(clear).toHaveBeenCalledOnce();
});
