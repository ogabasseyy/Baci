import { EVIDENCE_SCHEMA, type RunMode, SANDBOX_HOST } from './constants';
import type { EvidenceDocument, ProofResult, ShapeRecord } from './types';

export const GUARDS: readonly string[] = [
  `base URL host must be exactly ${SANDBOX_HOST}; API key must be a test key`,
  'dry-run is the default and uses mocks only; live-readonly sends GET only',
  'mutations need --live-sandbox-mutations, an allowlist of QA customer ids, a journaled intent and a unique reference',
  'the protected recording account is refused in arguments, requests and responses',
  'evidence is scanned for ids, emails, phones, BVNs, account numbers, keys and balances before it is written',
];

/** Every response-shape assumption the first live run has to confirm or refute. */
export const ASSUMPTIONS_TO_CONFIRM: readonly string[] = [
  'GET /api/v1/customers with third_party_identifier returns a list under paginatedPayload.edges, edges, or a bare array (the container found is recorded).',
  'Customer list rows carry the customer id as customer_id or id.',
  'GET /api/v1/wallet/:id returns api_customer_id (undocumented); wallet ownership is proven from it and nothing weaker.',
  'Wallet list rows (orderBy ASC/DESC) carry id, name and created_at; otherwise default-wallet-by-order cannot be judged.',
  'TSQ for a wallet-to-wallet transfer accepts wallet_id as a filter; its field names for source, destination, fee and currency are unknown until observed.',
  'TSQ status vocabulary is success|pending|failed while list/single use successful; a 404 may mean unknown OR not yet indexed.',
  'POST /api/v1/transfer/test/funding is the sandbox stand-in for a bank deposit to a virtual account number; it may lag or not settle (seen on 17 Sep).',
  'The sandbox accepts a bank outflow to an operator-supplied NUBAN and bank code (PVB_PROOF_BANK_CODE, PVB_PROOF_BANK_ACCOUNT) and settles it.',
  'withdrawal_count appears on GET /wallet/:id for every wallet and updates within the polling window after a settled outflow.',
  'Accrual and transaction reads accept limit up to 100 and a cursor; sandbox rates are 0% so no accrual edge may exist to inspect.',
  'Synthetic QA identities (000-prefixed 11-digit BVN, example.test email) are accepted by the sandbox; the 17 Sep probe accepted an all-zeros BVN.',
  'POST /customers accepts interest_payout_wallet set to an Ogabassey business sandbox wallet (PVB_PROOF_BUSINESS_WALLET_ID) together with enable_interest_accrual=true; whether GET /wallet/:id can read the payout destination back is unknown.',
  'POST /wallet/sub-account accepts interest_payout_wallet, and a goal sub-wallet created with no payout of its own may or may not inherit the customer payout wallet.',
  'Webhook delivery cannot be observed by this harness; the credited-wallet field must be confirmed from the durable inbox.',
];

export function buildEvidence(input: {
  date: string;
  mode: RunMode;
  mockData: boolean;
  proofs: ProofResult[];
}): EvidenceDocument {
  return {
    schema: EVIDENCE_SCHEMA,
    date: input.date,
    mode: input.mode,
    sandboxHost: SANDBOX_HOST,
    mockData: input.mockData,
    guards: [...GUARDS],
    proofs: input.proofs,
    assumptionsToConfirm: [...ASSUMPTIONS_TO_CONFIRM],
  };
}

const cell = (text: string) =>
  text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function shapeTable(shape: ShapeRecord): string[] {
  const status = shape.httpStatus === null ? 'n/a' : String(shape.httpStatus);
  return [
    `#### ${cell(shape.name)} (HTTP ${status})`,
    '',
    '| Path | Type |',
    '| --- | --- |',
    ...shape.fields.map(
      (field) => `| ${cell(field.path)} | ${cell(field.type)} |`
    ),
    '',
  ];
}

function proofSection(proof: ProofResult): string[] {
  const lines = [
    `## ${proof.proof.toUpperCase()}: ${cell(proof.title)}`,
    '',
    `Status: **${proof.status}**${proof.reason ? ` (${cell(proof.reason)})` : ''}`,
    '',
  ];
  if (proof.findings.length > 0) {
    lines.push(
      '| Finding | Question | Answer | Detail |',
      '| --- | --- | --- | --- |'
    );
    for (const f of proof.findings) {
      lines.push(
        `| ${cell(f.id)} | ${cell(f.question)} | ${f.answer} | ${cell(f.detail ?? '')} |`
      );
    }
    lines.push('');
  }
  const entries = Object.entries(proof.values);
  if (entries.length > 0) {
    lines.push('Values:', '');
    for (const [key, value] of entries)
      lines.push(
        `- ${cell(key)}: ${value === null ? 'null' : cell(String(value))}`
      );
    lines.push('');
  }
  if (proof.shapes.length > 0)
    lines.push(
      'Response shapes (field names and types only):',
      '',
      ...proof.shapes.flatMap(shapeTable)
    );
  for (const note of proof.notes) lines.push(`> ${cell(note)}`);
  if (proof.notes.length > 0) lines.push('');
  return lines;
}

export function renderMarkdown(doc: EvidenceDocument): string {
  const counts = (proof: ProofResult) =>
    (['yes', 'no', 'unknown'] as const)
      .map((answer) => proof.findings.filter((f) => f.answer === answer).length)
      .join(' / ');
  return [
    `# PiggyVest sandbox contract evidence: ${doc.date}`,
    '',
    doc.mockData
      ? '> **MOCK DATA, not evidence.** Produced by --dry-run against the in-memory mock. Nothing here describes the real sandbox.'
      : `> Live run against the PiggyVest sandbox host ${doc.sandboxHost}. Mode: ${doc.mode}.`,
    '> Pseudonyms such as W1 or C1 are stable within this run only. No ids, account numbers, names, emails, phones, BVNs, keys or balances of people appear.',
    '',
    '## Summary',
    '',
    '| Proof | Status | Findings yes / no / unknown |',
    '| --- | --- | --- |',
    ...doc.proofs.map((p) => `| ${p.proof} | ${p.status} | ${counts(p)} |`),
    '',
    ...doc.proofs.flatMap(proofSection),
    '## Assumptions the live run must confirm',
    '',
    ...doc.assumptionsToConfirm.map((item) => `- ${cell(item)}`),
    '',
    '## Guards active in this run',
    '',
    ...doc.guards.map((item) => `- ${cell(item)}`),
    '',
  ].join('\n');
}

export function renderJson(doc: EvidenceDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
