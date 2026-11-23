import styles from './OxygenCustomerFormFields.module.css';

export function firstInvalidOxygenControl(
  form: HTMLFormElement,
  step: number,
  turn?: number
) {
  const section = `[data-step="${step}"]${turn === undefined ? '' : ` [data-oxygen-chat-question="${turn}"]`}`;
  const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    `${section} input, ${section} select`
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

export function validateOxygenSection(input: {
  form: HTMLFormElement;
  step: number;
  turn?: number;
  bankSelection: boolean;
  checkingAccount: boolean;
  bankVerified: boolean;
  requiresResidentialFile: boolean;
}):
  | { ok: true }
  | { ok: false; error: string; field?: HTMLInputElement | HTMLSelectElement } {
  const invalid = firstInvalidOxygenControl(input.form, input.step, input.turn);
  if (invalid) {
    return {
      ok: false,
      error: oxygenInvalidControlMessage(invalid),
      field: invalid,
    };
  }
  if (input.bankSelection && !new FormData(input.form).get('bank_name')) {
    return { ok: false, error: 'Choose your bank to continue.' };
  }
  if (
    input.checkingAccount &&
    (!input.bankVerified || !new FormData(input.form).get('account_name'))
  ) {
    return {
      ok: false,
      error: 'Verify your bank account before continuing.',
    };
  }
  if (input.requiresResidentialFile) {
    const upload =
      input.form.querySelector<HTMLInputElement>(
        'input[type="file"][aria-label="Proof of address"]'
      ) ?? undefined;
    return {
      ok: false,
      error: 'Attach a utility bill or proof of your home address.',
      field: upload,
    };
  }
  return { ok: true };
}
