import { expect, it, vi } from 'vitest';
import {
  clearOxygenControlError,
  clearOxygenFormErrors,
  firstInvalidOxygenControl,
  highlightOxygenControl,
  oxygenInvalidControlMessage,
} from './oxygen-form-invalid-field';

it('finds the first invalid field in the current step and highlights and clears it', () => {
  const form = document.createElement('form');
  form.innerHTML =
    '<div data-step="0"><input required></div><div data-step="1"><input value="ok" required><input required></div>';
  document.body.append(form);
  const invalid = firstInvalidOxygenControl(form, 1);
  expect(invalid).toBe(form.querySelector('[data-step="1"] input:last-child'));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0);
    return 1;
  });
  if (!invalid) throw new Error('Expected an invalid field');
  highlightOxygenControl(invalid, 'field-error');
  expect(invalid).toHaveAttribute('aria-invalid', 'true');
  expect(invalid).toHaveAttribute('aria-errormessage', 'field-error');
  expect(document.activeElement).toBe(invalid);
  clearOxygenControlError(invalid);
  expect(invalid).not.toHaveAttribute('aria-invalid');
  expect(invalid).not.toHaveAttribute('aria-errormessage');
  vi.restoreAllMocks();
  form.remove();
});

it('clears marked fields when leaving a step without touching unrelated errors', () => {
  const form = document.createElement('form');
  const marked = document.createElement('input');
  const unrelated = document.createElement('input');
  marked.setAttribute('aria-errormessage', 'field-error');
  marked.setAttribute('aria-invalid', 'true');
  unrelated.setAttribute('aria-invalid', 'true');
  form.append(marked, unrelated);
  clearOxygenFormErrors(form, 'field-error');
  expect(marked).not.toHaveAttribute('aria-invalid');
  expect(unrelated).toHaveAttribute('aria-invalid', 'true');
});

it('uses the field format hint for a pattern mismatch', () => {
  const input = document.createElement('input');
  input.pattern = '[0-9]+';
  input.title = 'Enter digits';
  input.value = 'abc';
  expect(oxygenInvalidControlMessage(input)).toBe('Enter digits');
});

it('shows the browser validation message for a nonempty invalid email', () => {
  const input = document.createElement('input');
  input.type = 'email';
  input.value = 'not-an-email';
  expect(oxygenInvalidControlMessage(input)).toBe(input.validationMessage);
});
