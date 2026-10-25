import type { HttpConfig } from './http';

const fields = [
  ['first_name', 'First name', 'text'],
  ['last_name', 'Last name', 'text'],
  ['middle_name', 'Middle name (optional)', 'text'],
  ['phone_number', 'Phone number (234 prefix)', 'tel'],
  ['email', 'Email', 'email'],
  ['bvn', 'BVN', 'password'],
  ['nin', 'NIN', 'password'],
  ['date_of_birth', 'Date of birth', 'date'],
  ['bank_code', 'Bank code', 'text'],
  ['bank_name', 'Bank name', 'text'],
  ['account_number', 'Account number', 'password'],
  ['account_name', 'Account name', 'text'],
  ['name_of_employer', 'Employer / business (if applicable)', 'text'],
  ['salary_amount', 'Salary / income amount', 'text'],
  ['salary_date', 'Salary day (1–31)', 'number'],
];
export function renderProbeUi(config: HttpConfig): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="probe-csrf" content="${config.csrf}"><title>Oxygen manual test</title><link rel="stylesheet" href="/style.css"></head><body>
 <main><h1>Oxygen manual test</h1><p class="environment">${config.environment.toUpperCase()} — real customer records may be created</p>
 <p>One test participant. Creation is manual; a rejected request needs explicit retry acknowledgement. No booking, approval, activation or dispatch. Nothing runs automatically. The local runner saves application checkpoints privately; authenticate again after a restart. A failed creation must be reconciled before starting again.</p>
 <p id="configuration">${config.configured ? 'Partner credentials are configured on the local server.' : 'Partner credentials are not configured. Restart the runner with --credentials to enter them privately in the terminal.'}</p>
 <button id="login" ${config.configured ? '' : 'disabled'}>1. Authenticate partner</button>
 <button id="load-banks" disabled>Load banks from Oxygen</button><p>Authenticate, then load banks and select your bank. The code and name fill automatically.</p>
 <form id="customer" data-creation-locked="${config.creationLocked === true}" data-request-created="${config.requestCreated === true}" data-customer-path="${config.customerPath ?? 'unknown'}" autocomplete="off"><h2>2. Create your application</h2><div class="fields">
 <label>Choose bank<select id="bank-select" disabled><option value="">Load banks first</option></select></label>
 ${fields.map(([name, label, type]) => `<label>${label}<input name="${name}" type="${type}" ${name === 'middle_name' || name === 'name_of_employer' ? '' : 'required'} ${name === 'bank_code' || name === 'bank_name' || name === 'account_name' ? 'readonly' : ''} autocomplete="off"></label>`).join('')}
 <label>Employment status<select name="employment_status"><option>EMPLOYED</option><option>PENSIONER</option><option>SELF_EMPLOYED</option><option>UNEMPLOYED</option></select></label></div>
 <label class="check"><input type="checkbox" name="own_details" required>I am submitting my own details and consent to sending them to Oxygen for this test.</label>
 <label class="check"><input type="checkbox" name="terms" required>I have reviewed and accept Oxygen's applicable customer terms. Obtain these from Oxygen before proceeding.</label>
 <p id="form-status" role="status" aria-live="polite">Authenticate before creating your application. Account name verifies automatically after bank, account number and phone are complete.</p><button id="create" disabled>Create one loan request</button></form>
 <section id="recovery" hidden><h2>Resume current application</h2><p id="recovery-status">Continue the current request. Authenticate, then check KYC status before continuing incomplete verification.</p><p id="kyc-status">KYC status has not been checked in this view.</p></section>
 <section id="retry-section"><h2>Retry a rejected test request</h2><p>A retry may create a duplicate. Review the earlier response first. Timeouts or lost responses cannot be unlocked here.</p><label class="check"><input type="checkbox" id="retry-ack">I understand the duplicate risk and choose to prepare one manual retry.</label><button id="prepare-retry" disabled>Enable one manual retry</button></section>
 <section><h2>3. Validate your OTP</h2><label>OTP<input id="otp" type="password" autocomplete="one-time-code"></label><label>New-user token (only if supplied separately)<input id="new-token" type="password" autocomplete="off"></label>
 <label class="check"><input type="checkbox" id="existing-customer-test">Test existing-customer validation on this same request (does not change the original customer classification).</label>
 <button data-action="validate-existing" disabled>Validate existing customer</button><button data-action="validate-new" disabled>Validate new customer</button>
 <button data-action="resend-otp" disabled>Resend OTP for this request</button>
 <h2>4. Selfie and eligibility</h2><button data-action="selfie" disabled>Get selfie verification link</button><a id="selfie" hidden target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open Oxygen selfie verification</a>
 <button data-action="kyc" disabled>Check KYC status</button><button data-action="eligibility" disabled>Check eligibility</button>
 <p>Eligibility is not loan approval. Reported amount units are unconfirmed. Unknown responses stop here; no automatic retries or polling.</p></section>
 <h2>Results</h2><p id="status" role="status" aria-live="polite">Ready for manual testing.</p><pre id="results" tabindex="0">Only sanitized codes, HTTP status, response-field types and recognized eligibility are shown. No raw identity data or tokens.</pre></main><script type="module" src="/client.js"></script></body></html>`;
}
export const probeStyles = `body{font:16px system-ui;background:#f5f7fa;color:#15213a;margin:0}main{max-width:900px;margin:auto;padding:24px}h1{margin-top:0}.environment{padding:14px;background:#ffe4c4;border-radius:8px;font-weight:700}.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}label{display:block;margin:12px 0}input,select{display:block;padding:10px;border:1px solid #758098;border-radius:5px;width:100%;box-sizing:border-box;font:inherit}.check{display:flex;gap:10px;align-items:start}.check input{width:auto}button,a{font:inherit;margin:8px 8px 8px 0;padding:10px 14px;border-radius:6px}button{border:0;background:#163f99;color:white;cursor:pointer}button:disabled{background:#d7dce5;color:#555;cursor:default}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e8edf4;padding:16px}section{margin-top:24px}a{color:#163f99}a[hidden]{display:none}`;
