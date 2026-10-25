export function installProbeDraft(form, state) {
  const draftKey = `oxygen-manual-draft:${document.querySelector('.environment').textContent.split(' ')[0]}`;
  const lockKey = `${draftKey}:create-lock`;
  const draftFields = [
    'first_name',
    'last_name',
    'middle_name',
    'phone_number',
    'email',
    'bvn',
    'nin',
    'date_of_birth',
    'bank_code',
    'account_number',
    'name_of_employer',
    'salary_amount',
    'salary_date',
    'employment_status',
  ];
  const draftStatus = document.createElement('p');
  draftStatus.setAttribute('role', 'status');
  form.prepend(draftStatus);
  const forgetDraft = document.createElement('button');
  forgetDraft.type = 'button';
  forgetDraft.textContent = 'Forget saved form';
  form.append(forgetDraft);
  function saveCreateLock() {
    try {
      if (state.isLocked()) sessionStorage.setItem(lockKey, 'locked');
      else sessionStorage.removeItem(lockKey);
    } catch {
      draftStatus.textContent = 'This browser cannot save the form.';
    }
  }
  function saveDraft() {
    if (state.isCreated()) return;
    try {
      const fields = Object.fromEntries(
        draftFields.map((name) => [name, form.elements.namedItem(name).value])
      );
      localStorage.setItem(
        draftKey,
        JSON.stringify({ expiresAt: Date.now() + 24 * 60 * 60 * 1000, fields })
      );
      draftStatus.textContent =
        'Form saved in this browser for 24 hours, including after creation. OTPs and consent are not saved.';
    } catch {
      draftStatus.textContent =
        'Autosave unavailable in this browser. Keep this tab open.';
    }
  }
  function clearDraft() {
    try {
      localStorage.removeItem(draftKey);
      sessionStorage.removeItem(draftKey);
    } catch {
      /* Storage may be unavailable. */
    }
    draftStatus.textContent = 'Saved form cleared.';
  }
  try {
    state.setLocked(sessionStorage.getItem(lockKey) === 'locked');
    const raw =
      localStorage.getItem(draftKey) || sessionStorage.getItem(draftKey);
    if (raw) {
      const draft = JSON.parse(raw);
      if (
        draft &&
        typeof draft.expiresAt === 'number' &&
        draft.expiresAt > Date.now() &&
        draft.expiresAt <= Date.now() + 24 * 60 * 60 * 1000 &&
        draft.fields &&
        typeof draft.fields === 'object'
      ) {
        for (const name of draftFields)
          if (
            typeof draft.fields[name] === 'string' &&
            draft.fields[name].length <= 200
          )
            form.elements.namedItem(name).value = draft.fields[name];
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            expiresAt: draft.expiresAt,
            fields: Object.fromEntries(
              draftFields.map((name) => [
                name,
                form.elements.namedItem(name).value,
              ])
            ),
          })
        );
        sessionStorage.removeItem(draftKey);
        state.onRestore(form.elements.namedItem('bank_code').value);
        draftStatus.textContent =
          'Saved form restored. Authenticate and reload banks to reverify the account. Check consent again.';
      } else clearDraft();
    }
  } catch {
    clearDraft();
  }
  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);
  forgetDraft.addEventListener('click', () => {
    clearDraft();
    form.reset();
    state.onForget();
  });
  return { saveDraft, clearDraft, saveCreateLock };
}
