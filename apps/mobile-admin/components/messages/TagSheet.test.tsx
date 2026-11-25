import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function renderSheet(selected: string[] = [], busy = false, saved = true) {
  const onAdd = vi.fn().mockResolvedValue(saved);
  const onRemove = vi.fn();
  render(
    <TagSheet
      busy={busy}
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

  it('bugfix: shows a quick tag as selected when the stored label differs only in case, punctuation or separators', () => {
    renderSheet(['Order_Issue', 'payment!']);

    expect(
      screen.getByRole('button', { name: 'Order issue, selected' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Payment, selected' })
    ).toBeInTheDocument();
    // Neither is listed a second time as a custom tag.
    expect(screen.getAllByRole('button', { name: /^Payment/ })).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: /^Order issue/ })
    ).toHaveLength(1);
  });

  it('lists a custom tag already on the chat and lets it be removed', () => {
    const { onRemove } = renderSheet(['vip-buyer']);
    fireEvent.click(
      screen.getByRole('button', { name: 'Vip buyer, selected' })
    );
    expect(onRemove).toHaveBeenCalledWith('vip-buyer');
  });

  it('adds a typed tag, clears the box once saved and ignores blank input', async () => {
    const { onAdd } = renderSheet();
    const add = screen.getByRole('button', { name: 'Add tag' });
    const input = screen.getByLabelText('New tag');
    expect(add).toBeDisabled();

    fireEvent.change(input, { target: { value: '  Wholesale ' } });
    fireEvent.click(add);

    expect(onAdd).toHaveBeenCalledWith('Wholesale');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('bugfix: does not offer to save a tag that has no letters or numbers', () => {
    const { onAdd } = renderSheet();
    const add = screen.getByRole('button', { name: 'Add tag' });
    const input = screen.getByLabelText('New tag');

    fireEvent.change(input, { target: { value: ' !!! ' } });

    expect(add).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'VIP!' } });
    expect(add).toBeEnabled();
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

  it('bugfix: ignores the keyboard submit while a save is pending', () => {
    const { onAdd } = renderSheet([], true);
    const input = screen.getByLabelText('New tag');
    expect(input).toHaveAttribute('readonly');

    fireEvent.change(input, { target: { value: 'Wholesale' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('bugfix: keeps the typed tag when saving fails so it can be tried again', async () => {
    const { onAdd } = renderSheet([], false, false);
    const input = screen.getByLabelText('New tag');
    const add = screen.getByRole('button', { name: 'Add tag' });

    fireEvent.change(input, { target: { value: 'Wholesale' } });
    fireEvent.click(add);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));

    // Nothing was saved: the text is still there, one tap retries it as is.
    expect(input).toHaveValue('Wholesale');
    fireEvent.click(add);
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd).toHaveBeenLastCalledWith('Wholesale');
  });

  it('bugfix: does not send a typed tag the chat already has', () => {
    const { onAdd, onRemove } = renderSheet(['order-issue']);
    const input = screen.getByLabelText('New tag');

    fireEvent.change(input, { target: { value: ' Order  Issue! ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    // Adding never removes: the tag stays on, and the box is cleared.
    expect(onAdd).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });
});
