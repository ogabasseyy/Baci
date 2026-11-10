import { type RefObject, useEffect } from 'react';

export function useOxygenFormErrorFocus(
  form: RefObject<HTMLFormElement | null>,
  error: string,
  focusInvalidField: RefObject<boolean>
) {
  useEffect(() => {
    if (error && !focusInvalidField.current)
      form.current?.querySelector<HTMLElement>('[role=alert]')?.focus();
    focusInvalidField.current = false;
  }, [error, form, focusInvalidField]);
}
