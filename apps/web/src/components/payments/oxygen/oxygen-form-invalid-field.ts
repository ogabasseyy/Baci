import styles from './OxygenCustomerFormFields.module.css';

export function firstInvalidOxygenControl(form: HTMLFormElement, step: number) {
  const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    `[data-step="${step}"] input, [data-step="${step}"] select`
  );
  return Array.from(controls).find((control) => !control.checkValidity());
}

export function highlightOxygenControl(input: HTMLElement) {
  input.setAttribute('aria-invalid', 'true');
  input.classList.add(styles.invalid);
  requestAnimationFrame(() => {
    input.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    input.focus({ preventScroll: true });
  });
}

export function clearOxygenControlError(target: EventTarget) {
  if (target instanceof HTMLElement) {
    target.removeAttribute('aria-invalid');
    target.classList.remove(styles.invalid);
  }
}
