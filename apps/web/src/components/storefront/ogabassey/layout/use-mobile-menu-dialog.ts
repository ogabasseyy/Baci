import { useEffect, useRef } from 'react';

interface UseMobileMenuDialogOptions {
  isOpen: boolean;
  onClose: (reason?: 'dismiss' | 'navigate') => void;
}

export function useMobileMenuDialog({
  isOpen,
  onClose,
}: UseMobileMenuDialogOptions) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(isOpen);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  // Capture trigger element on open; restore focus when transitioning from open to closed
  useEffect(() => {
    if (isOpen) {
      const active = document.activeElement;
      triggerElementRef.current = active instanceof HTMLElement ? active : null;
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current && !isOpen) {
      triggerElementRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // Body scroll lock while dialog is open
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Keyboard navigation: Escape to dismiss, Tab to trap focus within dialog
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose('dismiss');
        return;
      }

      if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) {
          return;
        }

        const focusableElements = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), [href]:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) {
          event.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          if (
            document.activeElement === firstElement ||
            !dialog.contains(document.activeElement)
          ) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          if (
            document.activeElement === lastElement ||
            !dialog.contains(document.activeElement)
          ) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return { dialogRef, closeButtonRef };
}
