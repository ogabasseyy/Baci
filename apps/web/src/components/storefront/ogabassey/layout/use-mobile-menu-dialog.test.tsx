import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileMenuDialog } from './use-mobile-menu-dialog';

describe('useMobileMenuDialog', () => {
  let originalOverflow: string;

  beforeEach(() => {
    originalOverflow = document.body.style.overflow;
  });

  afterEach(() => {
    document.body.style.overflow = originalOverflow;
    vi.restoreAllMocks();
  });

  it('locks body scroll when opened and restores it when closed', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(
      ({ isOpen }) => useMobileMenuDialog({ isOpen, onClose }),
      { initialProps: { isOpen: false } }
    );

    expect(document.body.style.overflow).toBe('');

    rerender({ isOpen: true });
    expect(document.body.style.overflow).toBe('hidden');

    rerender({ isOpen: false });
    expect(document.body.style.overflow).toBe('');
  });

  it('restores body scroll on unmount if still open', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() =>
      useMobileMenuDialog({ isOpen: true, onClose })
    );

    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  function TestDialog({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) {
    const { dialogRef, closeButtonRef } = useMobileMenuDialog({
      isOpen,
      onClose,
    });

    if (!isOpen) {
      return null;
    }

    return (
      <div ref={dialogRef} role="dialog" aria-modal="true" data-testid="dialog">
        <button ref={closeButtonRef} type="button" data-testid="close-button">
          Close
        </button>
        <button type="button" data-testid="first-action">
          First Action
        </button>
        <a href="#link" data-testid="nav-link">
          Navigation Link
        </a>
      </div>
    );
  }

  it('moves focus to the close button on open and restores focus to trigger on close', () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('data-testid', 'trigger-btn');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const { rerender } = render(
      <TestDialog isOpen={false} onClose={onClose} />
    );

    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<TestDialog isOpen={true} onClose={onClose} />);
    const closeBtn = screen.getByTestId('close-button');
    expect(document.activeElement).toBe(closeBtn);

    rerender(<TestDialog isOpen={false} onClose={onClose} />);
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });

  it('handles non-HTMLElement activeElement safely when opening dialog', () => {
    const svgElem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgElem.setAttribute('tabindex', '0');
    document.body.appendChild(svgElem);
    svgElem.focus();
    expect(document.activeElement).toBe(svgElem);

    const onClose = vi.fn();
    const { rerender } = render(
      <TestDialog isOpen={false} onClose={onClose} />
    );

    expect(() => {
      rerender(<TestDialog isOpen={true} onClose={onClose} />);
    }).not.toThrow();

    const closeBtn = screen.getByTestId('close-button');
    expect(document.activeElement).toBe(closeBtn);

    expect(() => {
      rerender(<TestDialog isOpen={false} onClose={onClose} />);
    }).not.toThrow();

    document.body.removeChild(svgElem);
  });

  it('does not restore focus on unmount to prevent focus stealing across navigations', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const { unmount } = render(
      <TestDialog isOpen={true} onClose={onClose} />
    );

    const otherTarget = document.createElement('input');
    document.body.appendChild(otherTarget);
    otherTarget.focus();

    unmount();
    // Focus should remain on the newly navigated/active input, not stolen back to trigger
    expect(document.activeElement).toBe(otherTarget);

    document.body.removeChild(trigger);
    document.body.removeChild(otherTarget);
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<TestDialog isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('dismiss');
  });

  it('traps Tab navigation within the dialog elements', () => {
    const onClose = vi.fn();
    render(<TestDialog isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByTestId('close-button');
    const link = screen.getByTestId('nav-link');

    // Focus first element (close button) and press Shift+Tab -> should wrap to last element (link)
    closeBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(link);

    // Focus last element (link) and press Tab -> should wrap to first element (close button)
    link.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);
  });
});
