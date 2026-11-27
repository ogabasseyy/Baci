import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';

vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({
    children,
    visible,
  }: {
    children: ReactNode;
    visible: boolean;
  }) => (visible ? <div>{children}</div> : null),
}));

import { ChoiceSheetModal } from './ChoiceSheetModal';

const options = ['One', 'Two', 'Three', 'Four', 'Five'].map((label) => ({
  label,
  value: label.toLowerCase(),
}));

function renderSheet(visible = true) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <ChoiceSheetModal
      colors={LIGHT_COLORS}
      message="Pick one"
      onClose={onClose}
      onSelect={onSelect}
      options={options}
      title="Choose"
      visible={visible}
    />
  );
  return { onSelect, onClose };
}

describe('ChoiceSheetModal', () => {
  it('bugfix: shows every option, not just the first three an Android alert keeps', () => {
    renderSheet();
    for (const { label } of options) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('reports the chosen value', () => {
    const { onSelect } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Five' }));
    expect(onSelect).toHaveBeenCalledWith('five');
  });

  it('closes from Cancel without choosing', () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing while hidden', () => {
    renderSheet(false);
    expect(screen.queryByRole('button', { name: 'One' })).toBeNull();
  });
});
