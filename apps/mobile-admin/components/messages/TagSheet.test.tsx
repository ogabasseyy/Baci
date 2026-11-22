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

import { TagSheet } from './TagSheet';

function renderSheet(selected: string[] = []) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <TagSheet
      busy={false}
      colors={LIGHT_COLORS}
      onAdd={onAdd}
      onClose={vi.fn()}
      onRemove={onRemove}
      selected={selected}
      visible
    />
  );
  return { onAdd, onRemove };
}

describe('TagSheet', () => {
  it('adds a quick tag by its readable name', () => {
    const { onAdd } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Order issue' }));
    expect(onAdd).toHaveBeenCalledWith('Order issue');
  });

  it('removes a selected quick tag using its stored slug', () => {
    const { onRemove } = renderSheet(['order-issue']);
    fireEvent.click(
      screen.getByRole('button', { name: 'Order issue, selected' })
    );
    expect(onRemove).toHaveBeenCalledWith('order-issue');
  });

  it('lists a custom tag already on the chat and lets it be removed', () => {
    const { onRemove } = renderSheet(['vip-buyer']);
    fireEvent.click(
      screen.getByRole('button', { name: 'Vip buyer, selected' })
    );
    expect(onRemove).toHaveBeenCalledWith('vip-buyer');
  });

  it('adds a typed tag and ignores blank input', () => {
    const { onAdd } = renderSheet();
    const add = screen.getByRole('button', { name: 'Add tag' });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText('New tag'), {
      target: { value: '  Wholesale ' },
    });
    fireEvent.click(add);

    expect(onAdd).toHaveBeenCalledWith('Wholesale');
  });

  it('stops offering more tags once the chat has five', () => {
    const { onAdd } = renderSheet(['a', 'b', 'c', 'd', 'e']);
    expect(
      screen.getByText('This chat has 5 tags. Remove one to add another.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
