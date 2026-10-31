import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadRawConfig,
  TASK_ID,
  validSummary,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import {
  findChangedSummaries,
  findEvidenceAndDarkUntil,
  validateSummary,
} from './money-pr-assurance-summary.mjs';

const { summary: summaryConfig, evidence } = parseAssuranceConfig(
  loadRawConfig()
);
const options = {
  taskId: TASK_ID,
  headings: summaryConfig.headings,
  maxWords: summaryConfig.maxWords,
};

function errorsFor(text, overrides = {}) {
  return validateSummary(text, { ...options, ...overrides }).errors;
}

test('a summary that follows the template passes and reports its sign-off need', () => {
  const result = validateSummary(validSummary(), options);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ownerSignoffRequired, true);
  assert.ok(result.wordCount > 50 && result.wordCount < 450);
  assert.equal(
    validateSummary(validSummary({ signoff: 'not required' }), options)
      .ownerSignoffRequired,
    false
  );
});

test('a missing, renamed or reordered heading fails', () => {
  const missing = validSummary().replace('## How it is tested\n', '');
  assert.match(
    errorsFor(missing).join('\n'),
    /Missing heading "How it is tested"/
  );
  const renamed = validSummary().replace('## Why', '## Reasons');
  assert.match(errorsFor(renamed).join('\n'), /Unexpected heading "Reasons"/);
  const swapped = validSummary()
    .replace('## What changes', '## TMP')
    .replace('## Why', '## What changes')
    .replace('## TMP', '## Why');
  assert.match(errorsFor(swapped).join('\n'), /order/);
});

test('an empty section or a missing title fails', () => {
  const empty = validSummary().replace(
    'Every transfer needs one durable record before any money moves.',
    ''
  );
  assert.match(errorsFor(empty).join('\n'), /Section "Why" is empty/);
  const untitled = validSummary().replace(
    '# Ledger tables for the transfer engine',
    ''
  );
  assert.match(errorsFor(untitled).join('\n'), /title/);
});

test('more than 450 words fails', () => {
  const padding = Array.from(
    { length: 400 },
    (_, index) => `word${index}`
  ).join(' ');
  assert.match(
    errorsFor(validSummary({ extra: padding })).join('\n'),
    /over the 450-word limit/
  );
});

test('code, SQL and markup are rejected so the owner reads plain English', () => {
  const samples = [
    ['```\nconst x = 1\n```', /code block/],
    ['Calls `transfer()` once.', /backticks/],
    ['    indented code line', /indented/],
    ['SELECT amount FROM wallets', /SQL/],
    ['It will create table ledgers first.', /SQL/],
    ['Then grant execute on the function.', /SQL/],
    ['The refund_customer_wallet function changes.', /code identifier/],
    ['A check like a => b runs.', /code/],
    ['A <script> tag.', /markup/],
  ];
  for (const [line, pattern] of samples) {
    const errors = errorsFor(validSummary({ extra: `\n${line}\n` }));
    assert.match(errors.join('\n'), pattern, line);
  }
  // Ordinary English that uses SQL words is allowed.
  const english =
    'Customers select a device from the list and update their goal later.';
  assert.deepEqual(errorsFor(validSummary({ extra: `\n${english}\n` })), []);
  // Nested list items are not mistaken for indented code.
  assert.deepEqual(
    errorsFor(validSummary({ extra: '\n- First\n    - Second\n' })),
    []
  );
});

test('HTML comments are not counted and an unclosed comment fails', () => {
  const hidden = Array.from({ length: 500 }, () => 'note').join(' ');
  assert.deepEqual(
    errorsFor(validSummary({ extra: `\n<!-- ${hidden} -->\n` })),
    []
  );
  assert.match(
    errorsFor(validSummary({ extra: '\n<!-- never closed\n' })).join('\n'),
    /comment/
  );
});

test('the task line must match the file name and the sign-off line must be valid', () => {
  assert.match(
    errorsFor(validSummary({ taskId: 'OTHER' })).join('\n'),
    /Task line/
  );
  const noSignoff = validSummary().replace('Owner sign-off: required\n', '');
  const result = validateSummary(noSignoff, options);
  assert.match(result.errors.join('\n'), /Owner sign-off/);
  assert.equal(
    result.ownerSignoffRequired,
    true,
    'a missing sign-off line fails closed'
  );
  const bogus = validSummary({ signoff: 'maybe' });
  assert.match(errorsFor(bogus).join('\n'), /Owner sign-off/);
  assert.equal(validateSummary(bogus, options).ownerSignoffRequired, true);
});

test('Windows line endings are accepted', () => {
  assert.deepEqual(errorsFor(validSummary().replaceAll('\n', '\r\n')), []);
});

test('changed summaries are found by path and badly named ones are reported', () => {
  const found = findChangedSummaries(
    [
      {
        filename: `docs/piggyvest-change-summaries/${TASK_ID}.md`,
        status: 'added',
      },
      {
        filename: 'docs/piggyvest-change-summaries/TEMPLATE.md',
        status: 'modified',
      },
      {
        filename: 'docs/piggyvest-change-summaries/OLD-task.md',
        status: 'removed',
      },
      {
        filename: 'docs/piggyvest-change-summaries/nested/x.md',
        status: 'added',
      },
      {
        filename: 'docs/piggyvest-change-summaries/bad name.md',
        status: 'added',
      },
      { filename: 'docs/other/x.md', status: 'added' },
    ],
    summaryConfig
  );
  assert.deepEqual(found.summaries, [
    { path: `docs/piggyvest-change-summaries/${TASK_ID}.md`, taskId: TASK_ID },
  ]);
  assert.equal(found.errors.length, 2);
  assert.match(found.errors.join('\n'), /nested\/x\.md/);
  assert.match(found.errors.join('\n'), /bad name\.md/);
});

test('sandbox evidence links and dark-until statements are read from the PR body', () => {
  const linked = findEvidenceAndDarkUntil(
    'See https://github.com/o/r/blob/main/docs/piggyvest-contract-evidence/2026-10-31.md and docs/piggyvest-contract-evidence/2026-10-31-2.json.',
    evidence.directory
  );
  assert.deepEqual(linked.evidencePaths, [
    'docs/piggyvest-contract-evidence/2026-10-31.md',
    'docs/piggyvest-contract-evidence/2026-10-31-2.json',
  ]);
  assert.equal(linked.darkUntil, null);

  assert.equal(
    findEvidenceAndDarkUntil(
      '**Dark until:** `PIGGYVEST_TRANSFER_ENGINE_ENABLED` is turned on',
      evidence.directory
    ).darkUntil,
    'PIGGYVEST_TRANSFER_ENGINE_ENABLED is turned on'
  );
  assert.equal(
    findEvidenceAndDarkUntil(
      'This stays dark until the readiness gate passes.',
      evidence.directory
    ).darkUntil,
    'the readiness gate passes'
  );
});

test('placeholders, hidden comments and path tricks do not count as evidence', () => {
  for (const body of [
    'Dark until: <flag/gate>',
    'Dark until: TBD',
    'Dark until: n/a',
    'Dark until:',
    '<!-- Dark until: launch flag -->',
  ]) {
    assert.equal(
      findEvidenceAndDarkUntil(body, evidence.directory).darkUntil,
      null,
      body
    );
  }
  assert.deepEqual(
    findEvidenceAndDarkUntil(
      'docs/piggyvest-contract-evidence/../../secrets.md',
      evidence.directory
    ).evidencePaths,
    []
  );
  assert.deepEqual(findEvidenceAndDarkUntil(null, evidence.directory), {
    evidencePaths: [],
    darkUntil: null,
  });
});

test('reported line numbers count lines hidden in comments', () => {
  const text = validSummary({ extra: '\n<!--\none\ntwo\n-->\nUses `code`.\n' });
  const lines = text.split('\n');
  const expected = lines.findIndex((line) => line.includes('`code`')) + 1;
  assert.match(errorsFor(text).join('\n'), new RegExp(`line ${expected}\\)`));
});

test('a task id with underscores on the Task line is not flagged as code', () => {
  const text = validSummary({ taskId: 'p6_wallet_pin' });
  assert.deepEqual(errorsFor(text, { taskId: 'p6_wallet_pin' }), []);
});
