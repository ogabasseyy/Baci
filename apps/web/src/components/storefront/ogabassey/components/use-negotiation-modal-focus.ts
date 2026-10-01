import { useEffect, useRef } from 'react';
import type { NegotiationStatus } from './use-negotiation-modal-controller';

export function useNegotiationModalFocus({
  isOpen,
  onClose,
  status,
}: {
  isOpen: boolean;
  onClose: () => void;
  status: NegotiationStatus;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const offerInputRef = useRef<HTMLInputElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = () => {
    if (!dialogRef.current) return [] as HTMLElement[];
    return Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => {
      if (element.closest('[hidden], [aria-hidden="true"]')) return false;
      for (
        let candidate: HTMLElement | null = element;
        candidate;
        candidate = candidate.parentElement
      ) {
        const style = window.getComputedStyle(candidate);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }
      }
      return true;
    });
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isOpen) {
      previouslyFocusedElementRef.current?.focus();
      previouslyFocusedElementRef.current = null;
      return;
    }
    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || status !== 'input' || typeof window === 'undefined') return;
    const frame = window.requestAnimationFrame(() => {
      if (offerInputRef.current) {
        offerInputRef.current.focus();
        return;
      }
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
        return;
      }
      dialogRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, status]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (
        event.shiftKey &&
        (!activeElement ||
          !dialogRef.current?.contains(activeElement) ||
          activeElement === firstElement)
      ) {
        event.preventDefault();
        lastElement.focus();
        return;
      }
      if (
        !event.shiftKey &&
        (!activeElement ||
          !dialogRef.current?.contains(activeElement) ||
          activeElement === lastElement)
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(
    () => () => {
      previouslyFocusedElementRef.current?.focus();
      previouslyFocusedElementRef.current = null;
    },
    []
  );

  return { dialogRef, offerInputRef };
}
