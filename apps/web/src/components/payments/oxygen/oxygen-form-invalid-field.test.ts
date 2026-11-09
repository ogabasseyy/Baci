import { expect, it, vi } from 'vitest';
import {
  clearOxygenControlError,
  firstInvalidOxygenControl,
  highlightOxygenControl,
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
