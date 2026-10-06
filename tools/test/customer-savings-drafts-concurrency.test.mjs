import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const [usersFile, merchantId, productId, variantId, otherVariantId] =
  process.argv.slice(2);
const users = JSON.parse(readFileSync(usersFile, 'utf8'));
const actorId = users.find((user) => user.role === 'customer')?.id;
const otherActorId = users.find((user) => user.role === 'owner')?.id;
for (const identifier of [
  merchantId,
  productId,
  variantId,
  otherVariantId,
  actorId,
  otherActorId,
]) {
  assert.match(
    identifier,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
}
const command = [
  'exec',
  '-i',
  'supabase_db_baci-savings-local-lfikp5',
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-X',
  '-qAt',
  '-v',
  'ON_ERROR_STOP=1',
  '-v',
  'VERBOSITY=verbose',
];
const sessions = new Set();
function sql(statement) {
  const result = spawnSync('docker', command, {
    input: statement,
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function session() {
  const child = spawn('docker', command, { stdio: ['pipe', 'pipe', 'pipe'] });
  sessions.add(child);
  const state = { child, output: '', error: '', done: false };
  child.stdout.on('data', (chunk) => {
    state.output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    state.error += chunk;
  });
  state.finished = new Promise((resolve) => {
    child.on('close', (status) => {
      state.done = true;
      sessions.delete(child);
      resolve(status);
    });
  });
  return state;
}
async function until(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail(label);
}
function begin(actor = actorId) {
  return `BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${actor}'; SET LOCAL request.jwt.claim.role='authenticated';`;
}
function rpc(action, input) {
  return `SELECT public.customer_savings_draft_command('${merchantId}','${action}','${JSON.stringify(input)}');`;
}
function draft(output) {
  return JSON.parse(output.split('\n').find((line) => line.startsWith('{')))
    .draft;
}
async function race(firstStatement, secondStatement, expectedState) {
  const first = session();
  const second = session();
  const waiter = `draft_test_${randomUUID().replaceAll('-', '')}`;
  try {
    first.child.stdin.write(`${begin()} ${firstStatement}\n\\echo LOCK_HELD\n`);
    await until(
      () => first.output.includes('LOCK_HELD') || first.done,
      'first command did not finish'
    );
    assert.equal(first.done, false, first.error);
    second.child.stdin.end(
      `${begin()} SET LOCAL application_name='${waiter}'; ${secondStatement} COMMIT;\n`
    );
    await until(
      () =>
        sql(
          `SELECT count(*) FROM pg_stat_activity WHERE application_name='${waiter}' AND wait_event_type='Lock';`
        ) === '1' || second.done,
      'second command did not block'
    );
    assert.equal(second.done, false, second.error);
    first.child.stdin.end('COMMIT;\n');
    assert.equal(await first.finished, 0, first.error);
    const status = await second.finished;
    if (expectedState) {
      assert.notEqual(status, 0);
      assert.match(second.error, new RegExp(`\\b${expectedState}\\b`));
    } else {
      assert.equal(status, 0, second.error);
      assert.deepEqual(draft(second.output), draft(first.output));
    }
    return draft(first.output);
  } finally {
    for (const connection of [first, second]) {
      if (!connection.done && !connection.child.stdin.writableEnded)
        connection.child.stdin.end('ROLLBACK;\n');
    }
  }
}
function moneyCounts() {
  return sql(`SELECT jsonb_build_array(
    (SELECT count(*) FROM public.customer_savings_goals),
    (SELECT count(*) FROM public.customer_savings_contributions),
    (SELECT count(*) FROM piggyvest_savings_ledger.operations),
    (SELECT count(*) FROM public.customer_wallet_transactions));`);
}

try {
  assert.equal(
    sql(
      `SELECT count(*) FROM savings_draft_private.settings WHERE merchant_id='${merchantId}' AND enabled AND environment='local_test';`
    ),
    '1',
    'parent must explicitly enable the synthetic fixture first'
  );
  const before = moneyCounts();
  const requestId = randomUUID();
  const input = { productId, variantId, requestId };
  const created = await race(rpc('create', input), rpc('create', input));
  assert.equal(created.acceptedAt, null);
  assert.deepEqual(
    draft(sql(`${begin()} ${rpc('create', input)} COMMIT;`)),
    created
  );
  const reloaded = sql(`${begin()} ${rpc('list', { requestId })} COMMIT;`);
  assert.deepEqual(JSON.parse(reloaded).drafts, [created]);
  assert.equal(
    sql(
      `SELECT count(*) FROM public.customer_savings_drafts WHERE merchant_id='${merchantId}' AND request_id='${requestId}';`
    ),
    '1'
  );
  console.log(
    'PASS concurrent identical create, durable replay and reload: one draft'
  );

  const collisionInput = { ...input, requestId: randomUUID() };
  await race(
    rpc('create', collisionInput),
    rpc('create', { ...collisionInput, variantId: otherVariantId }),
    '23505'
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM public.customer_savings_drafts WHERE merchant_id='${merchantId}' AND request_id='${collisionInput.requestId}';`
    ),
    '1'
  );
  console.log('PASS concurrent different-payload collision: 23505, one draft');

  const acceptance = {
    draftId: created.draftId,
    revisionId: created.revisionId,
    termsVersion: created.terms.version,
    termsHash: created.terms.hash,
    accepted: true,
  };
  const accepted = await race(
    rpc('accept', acceptance),
    rpc('accept', acceptance)
  );
  assert.ok(accepted.acceptedAt);
  assert.deepEqual(
    draft(sql(`${begin()} ${rpc('accept', acceptance)} COMMIT;`)),
    accepted
  );
  console.log(
    'PASS concurrent acceptance and durable retry: identical receipt'
  );

  assert.equal(
    sql(
      `${begin(otherActorId)} SELECT count(*) FROM public.customer_savings_drafts WHERE id='${created.draftId}'; ROLLBACK;`
    ),
    '0'
  );
  const denied = spawnSync('docker', command, {
    input: `${begin(otherActorId)} ${rpc('policy', { draftId: created.draftId })} ROLLBACK;`,
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /\b(42501|P0002)\b/);
  assert.equal(moneyCounts(), before);
  console.log('PASS cross-customer RLS/RPC denial and unchanged money tables');
  console.log(
    'Retained two synthetic zero-money drafts in disposable local container; no price lock or activation.'
  );
} finally {
  for (const child of sessions) {
    if (!child.stdin.writableEnded) child.stdin.end('ROLLBACK;\n');
  }
}
