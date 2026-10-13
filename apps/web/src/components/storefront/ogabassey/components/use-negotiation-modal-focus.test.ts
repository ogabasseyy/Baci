import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useNegotiationModalFocus } from './use-negotiation-modal-focus';

function FocusHarness({
  isOpen = true,
  onClose,
}: {
  isOpen?: boolean;
  onClose: () => void;
}) {
  const { dialogRef, offerInputRef } = useNegotiationModalFocus({
    isOpen,
    onClose,
    status: 'input',
  });
  return createElement(
    'div',
    { ref: dialogRef, role: 'dialog', tabIndex: -1 },
    createElement('input', { 'aria-label': 'Offer', ref: offerInputRef }),
    createElement('button', { hidden: true, type: 'button' }, 'Hidden action'),
    createElement('button', { type: 'button' }, 'Last action')
  );
}

function EmptyFocusHarness() {
  const { dialogRef } = useNegotiationModalFocus({
    isOpen: true,
    onClose: vi.fn(),
    status: 'input',
  });
  return createElement('div', { ref: dialogRef, role: 'dialog', tabIndex: -1 });
}

describe('useNegotiationModalFocus', () => {
  it('focuses the offer and closes on Escape', async () => {
    const onClose = vi.fn();
    render(createElement(FocusHarness, { onClose }));

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Offer' })).toHaveFocus()
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores Escape when the modal is closed', () => {
    const onClose = vi.fn();
    render(createElement(FocusHarness, { isOpen: false, onClose }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses the dialog on Tab when it has no focusable controls', async () => {
    render(createElement(EmptyFocusHarness));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('wraps forward tab focus from the last action', async () => {
    render(createElement(FocusHarness, { onClose: vi.fn() }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Offer' })).toHaveFocus()
    );
    screen.getByRole('button', { name: 'Last action' }).focus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('textbox', { name: 'Offer' })).toHaveFocus();
  });

  it('wraps reverse tab focus from the first control', async () => {
    render(createElement(FocusHarness, { onClose: vi.fn() }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Offer' })).toHaveFocus()
    );

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();
  });

  it('restores the trigger focus when the modal closes', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { rerender } = render(
      createElement(FocusHarness, { isOpen: true, onClose: vi.fn() })
    );

    rerender(
      createElement(FocusHarness, { isOpen: false, onClose: vi.fn() })
    );

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('restores the trigger focus when an open modal unmounts', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      createElement(FocusHarness, { isOpen: true, onClose: vi.fn() })
    );

    unmount();

    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
