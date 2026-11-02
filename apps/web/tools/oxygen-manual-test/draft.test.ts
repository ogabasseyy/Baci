import { afterEach, expect, it, vi } from 'vitest';
import { installProbeDraft } from './draft';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
it('persists only supported draft fields, keeps the create fence while forgetting form data', () => {
  const storage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  };
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  document.body.innerHTML = `<span class="environment">staging preview</span><form>${['first_name', 'last_name', 'middle_name', 'phone_number', 'email', 'bvn', 'nin', 'date_of_birth', 'bank_code', 'account_number', 'name_of_employer', 'salary_amount', 'salary_date', 'employment_status', 'otp'].map((name) => `<input name="${name}">`).join('')}</form>`;
  const form = document.querySelector('form') as HTMLFormElement;
  const state = {
    isLocked: () => true,
    isCreated: () => false,
    setLocked: vi.fn(),
    onRestore: vi.fn(),
    onForget: vi.fn(),
  };
  const draft = installProbeDraft(form, state);
  (form.elements.namedItem('first_name') as HTMLInputElement).value = 'Test';
  (form.elements.namedItem('otp') as HTMLInputElement).value = '123456';
  draft.saveDraft();
  draft.saveCreateLock();
  const saved = localStorage.getItem('oxygen-manual-draft:staging');
  expect(saved).toContain('Test');
  expect(saved).not.toContain('123456');
  expect(
    sessionStorage.getItem('oxygen-manual-draft:staging:create-lock')
  ).toBe('locked');
  expect(form.querySelector('button')).not.toBeNull();
  form.querySelector('button')?.click();
  expect(state.onForget).toHaveBeenCalledOnce();
  expect(localStorage.getItem('oxygen-manual-draft:staging')).toBeNull();
  expect(
    sessionStorage.getItem('oxygen-manual-draft:staging:create-lock')
  ).toBe('locked');
  expect(state.onForget).toHaveBeenCalledOnce();
});
