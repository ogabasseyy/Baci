import { installProbeDraft } from './draft.js';

const csrf = document
  .querySelector('meta[name="probe-csrf"]')
  ?.getAttribute('content');
const form = document.querySelector('#customer');
const status = document.querySelector('#status');
const formStatus = document.querySelector('#form-status');
const accountName = form.elements.namedItem('account_name');
let lookupTimer;
let lookupQueued = false;
function lookupInput() {
  return Object.fromEntries(
    ['bank_code', 'account_number', 'phone_number'].map((name) => [
      name,
      form.elements.namedItem(name).value,
    ])
  );
}
function scheduleLookup() {
  clearTimeout(lookupTimer);
  lookupQueued = false;
  accountName.value = '';
  const input = lookupInput();
  if (
    !authenticated ||
    !/^\d{3,10}$/.test(input.bank_code) ||
    !/^\d{10}$/.test(input.account_number) ||
    !/^234\d{10}$/.test(input.phone_number)
  )
    return;
  lookupTimer = setTimeout(() => {
    if (busy) lookupQueued = true;
    else run('name-enquiry', lookupInput());
  }, 500);
}
for (const name of ['account_number', 'phone_number'])
  form.elements.namedItem(name).addEventListener('input', scheduleLookup);
const results = document.querySelector('#results');
const login = document.querySelector('#login');
const create = document.querySelector('#create');
const retryControl = document.querySelector('#prepare-retry');
retryControl.addEventListener('click', () =>
  run('prepare-retry', {
    acknowledge_duplicate_risk: document.querySelector('#retry-ack').checked,
  })
);
const link = document.querySelector('#selfie');
let authenticated = false;
let created = form.dataset.requestCreated === 'true';
let customerPath = form.dataset.customerPath;
let restoredBankCode = '';
let createLocked = created || form.dataset.creationLocked === 'true';
let busy = false;
const configured = !login.disabled;
const loadBanks = document.querySelector('#load-banks');
const bankSelect = document.querySelector('#bank-select');
let banks = [];
loadBanks.addEventListener('click', () => run('banks'));
bankSelect.addEventListener('change', () => {
  const bank = banks.find((entry) => entry.code === bankSelect.value);
  form.elements.namedItem('bank_code').value = bank?.code || '';
  form.elements.namedItem('bank_name').value = bank?.name || '';
  scheduleLookup();
  saveDraft();
});
const existingCustomerTest = document.querySelector('#existing-customer-test');
existingCustomerTest.addEventListener('change', buttons);
function buttons() {
  existingCustomerTest.disabled = busy || !created;
  form.hidden = created;
  document.querySelector('#recovery').hidden = !created;
  document.querySelector('#retry-section').hidden = created;
  retryControl.disabled = busy || !authenticated || !createLocked || created;
  login.disabled = busy || !configured;
  loadBanks.disabled = busy || !authenticated;
  bankSelect.disabled = busy || !authenticated || banks.length === 0;
  create.disabled = busy || !authenticated || createLocked;
  for (const button of document.querySelectorAll('[data-action]')) {
    const mismatch =
      (button.dataset.action === 'validate-new' && customerPath !== 'new') ||
      (button.dataset.action === 'validate-existing' &&
        customerPath !== 'existing' &&
        !existingCustomerTest.checked);
    button.disabled = busy || !authenticated || !created || mismatch;
  }
}
async function run(action, input = {}) {
  if (busy) return;
  busy = true;
  if (action === 'create') {
    createLocked = true;
    saveCreateLock();
  }
  buttons();
  status.textContent = 'Sending your manual request…';
  formStatus.textContent = status.textContent;
  try {
    const response = await fetch('/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-probe-csrf': csrf },
      body: JSON.stringify({ action, input }),
      cache: 'no-store',
    });
    const result = await response.json();
    if (action === 'login') authenticated = result.code === 'authenticated';
    if (result.code === 'login_required') authenticated = false;
    if (
      action === 'create' &&
      ['invalid_input', 'login_required', 'credentials_required'].includes(
        result.code
      )
    ) {
      createLocked = false;
      saveCreateLock();
    }
    if (result.code === 'retry_ready') {
      createLocked = false;
      saveCreateLock();
      document.querySelector('#retry-ack').checked = false;
    }
    if (result.code === 'request_created') {
      saveDraft();
      created = true;
      customerPath = result.customerPath;
    }
    if (action === 'banks') {
      banks = result.code === 'banks_loaded' ? result.banks : [];
      bankSelect.replaceChildren(new Option('Select your bank', ''));
      for (const bank of banks)
        bankSelect.add(new Option(`${bank.name} (${bank.code})`, bank.code));
      if (banks.some((bank) => bank.code === restoredBankCode))
        bankSelect.value = restoredBankCode;
      bankSelect.dispatchEvent(new Event('change'));
    }
    if (
      action === 'name-enquiry' &&
      JSON.stringify(input) === JSON.stringify(lookupInput())
    ) {
      accountName.value =
        result.code === 'account_name_resolved' ? result.accountName : '';
    }
    const { url, banks: bankList, accountName: resolvedName, ...safe } = result;
    if (action === 'selfie') {
      link.hidden = true;
      link.removeAttribute('href');
      if (url && result.code === 'selfie_link_ready') {
        link.href = url;
        link.hidden = false;
      }
    }
    if (result.code === 'existing_bvn_recovery_required') {
      document.querySelector('#recovery-status').textContent =
        'Oxygen reports an existing BVN. Your current request is preserved. Check KYC status; Oxygen must clarify how to recover the selfie link for this request.';
    }
    if (result.code === 'customer_validated') {
      document.querySelector('#recovery-status').textContent =
        'Customer validation succeeded. Continue this current request and check KYC status.';
    }
    if (result.code === 'kyc_status_received' && result.kyc) {
      document.querySelector('#kyc-status').textContent =
        `Address: ${result.kyc.address}. Selfie: ${result.kyc.selfie}.`;
    }
    results.textContent = JSON.stringify(safe, null, 2);
    status.textContent =
      result.code === 'login_required'
        ? 'Partner login expired. Authenticate again; this request was not sent to Oxygen.'
        : result.code === 'indeterminate'
          ? 'Response lost. Do not recreate or blindly retry. Check with Oxygen.'
          : result.code.replaceAll('_', ' ');
  } catch {
    status.textContent =
      'Local response lost. Do not recreate or retry a mutation. Keep this test session and check with Oxygen.';
  } finally {
    formStatus.textContent = status.textContent;
    busy = false;
    buttons();
    if (lookupQueued) scheduleLookup();
  }
}
login.addEventListener('click', async () => {
  await run('login');
  scheduleLookup();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity() || !authenticated || createLocked) return;
  saveDraft();
  const data = new FormData(form);
  const get = (name) => String(data.get(name) || '');
  run('create', {
    accept_terms_and_condition: 'yes',
    user_category: 'individual',
    customer_personal_details: Object.fromEntries(
      [
        'first_name',
        'last_name',
        'middle_name',
        'phone_number',
        'email',
        'bvn',
        'nin',
        'date_of_birth',
      ]
        .map((key) => [key, get(key)])
        .concat([['external_identifier', crypto.randomUUID()]])
    ),
    customer_bank_details: Object.fromEntries(
      ['bank_code', 'bank_name', 'account_number', 'account_name'].map(
        (key) => [key, get(key)]
      )
    ),
    customer_employment_details: {
      employment_status: get('employment_status'),
      name_of_employer: get('name_of_employer'),
      salary_amount: get('salary_amount'),
      salary_date: Number(get('salary_date')),
    },
  });
});
for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    const otp = document.querySelector('#otp');
    const token = document.querySelector('#new-token');
    const input = action.startsWith('validate')
      ? { otp: otp.value, token: token.value }
      : action === 'resend-otp'
        ? { existingCustomerTest: existingCustomerTest.checked }
        : {};
    otp.value = '';
    token.value = '';
    run(action, input);
  });
}

const { saveDraft, saveCreateLock } = installProbeDraft(form, {
  isCreated: () => created,
  isLocked: () => createLocked,
  setLocked: (value) => {
    createLocked = created || form.dataset.creationLocked === 'true' || value;
  },
  onRestore: (code) => {
    restoredBankCode = code;
  },
  onForget: () => {
    restoredBankCode = '';
    clearTimeout(lookupTimer);
    lookupQueued = false;
  },
});
buttons();
