import styles from './OxygenCustomerFormFields.module.css';

export function firstInvalidOxygenControl(form: HTMLFormElement, step: number) {
  const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    `[data-step="${step}"] input, [data-step="${step}"] select`
  );
  return Array.from(controls).find((control) => !control.checkValidity());
}

export function oxygenInvalidControlMessage(
  input: HTMLInputElement | HTMLSelectElement
) {
  if (input.validity.patternMismatch)
    return input.title || 'Check the format of the highlighted field.';
  if (!input.validity.valueMissing && input.validationMessage)
    return input.validationMessage;
  return 'Please complete the required fields in this step.';
}

export function highlightOxygenControl(input: HTMLElement, errorId?: string) {
  input.setAttribute('aria-invalid', 'true');
  if (errorId) input.setAttribute('aria-errormessage', errorId);
  input.classList.add(styles.invalid);
  requestAnimationFrame(() => {
    input.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    input.focus({ preventScroll: true });
  });
}

export function clearOxygenControlError(target: EventTarget) {
  if (target instanceof HTMLElement) {
    target.removeAttribute('aria-invalid');
    target.removeAttribute('aria-errormessage');
    target.classList.remove(styles.invalid);
  }
}

export function clearOxygenFormErrors(
  form: HTMLFormElement | null,
  errorId: string
) {
  form?.querySelectorAll('[aria-errormessage]').forEach((input) => {
    if (input.getAttribute('aria-errormessage') === errorId)
      clearOxygenControlError(input);
  });
}
