import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHostedSavingsAuthPreserved } from './hosted-savings-install-auth';

const principal = (name: string, oid?: number) => ({
  name,
  ...(oid === undefined ? {} : { oid }),
  superuser: false,
  bypassRls: false,
  createRole: false,
  createDb: false,
  replication: false,
  login: false,
});
const edge = (role: string, member: string) => ({
  role,
  member,
  grantor: 'postgres',
  adminOption: false,
  inheritOption: true,
  setOption: true,
});
const baseline = () => ({
  data: { users: 'unchanged' },
  roles: 'protected',
  schema: 'protected',
  principals: [principal('authenticated'), principal('authenticator')],
  memberships: [edge('authenticated', 'authenticator')],
});
const allowed = [{ role: 'baci_worker', member: 'baci_runner' }];
function fixture() {
  const before = baseline();
  const after = structuredClone(before);
  after.principals.push(principal('baci_worker'), principal('baci_runner'));
  after.memberships.push(edge('baci_worker', 'baci_runner'));
  return { before, after };
}

test('permits explicitly reviewed grant between new restricted Baci roles without changing existing Auth edges', () => {
  const { before, after } = fixture();
  assert.doesNotThrow(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after),
      allowed
    )
  );
  assert.throws(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after)
    )
  );
});

test('rejects grants reaching any preexisting principal even when allowlisted', () => {
  for (const name of ['authenticated', 'authenticator']) {
    const { before, after } = fixture();
    after.memberships.push(edge(name, 'baci_runner'));
    assert.throws(() =>
      assertHostedSavingsAuthPreserved(
        JSON.stringify(before),
        JSON.stringify(after),
        [...allowed, { role: name, member: 'baci_runner' }]
      )
    );
  }
});

test('permits exact reviewed repair capability grant to authenticator but rejects reversed or inheritable authority', () => {
  const before = baseline();
  const after = structuredClone(before);
  after.principals.push(principal('repair_pickup_receiver'));
  const grant = {
    ...edge('repair_pickup_receiver', 'authenticator'),
    inheritOption: false,
  };
  after.memberships.push(grant);
  const review = [{ role: grant.role, member: grant.member }];
  assert.doesNotThrow(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after),
      review
    )
  );
  assert.throws(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after)
    )
  );
  grant.inheritOption = true;
  assert.throws(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after),
      review
    )
  );
  grant.inheritOption = false;
  grant.role = 'authenticator';
  grant.member = 'repair_pickup_receiver';
  assert.throws(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after),
      [{ role: grant.role, member: grant.member }]
    )
  );
});

test('rejects new role elevation and membership administration escalation', () => {
  for (const flag of [
    'superuser',
    'bypassRls',
    'createRole',
    'createDb',
    'replication',
    'login',
  ] as const) {
    const { before, after } = fixture();
    after.principals[2][flag] = true;
    assert.throws(() =>
      assertHostedSavingsAuthPreserved(
        JSON.stringify(before),
        JSON.stringify(after),
        allowed
      )
    );
  }
  const { before, after } = fixture();
  after.memberships[1].adminOption = true;
  assert.throws(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after),
      allowed
    )
  );
});

test('preserves every original relationship including grantor and authorization options', () => {
  for (const flag of ['adminOption', 'inheritOption', 'setOption'] as const) {
    const { before, after } = fixture();
    after.memberships[0][flag] = !after.memberships[0][flag];
    assert.throws(() =>
      assertHostedSavingsAuthPreserved(
        JSON.stringify(before),
        JSON.stringify(after),
        allowed
      )
    );
  }
  for (const change of ['remove', 'grantor']) {
    const { before, after } = fixture();
    if (change === 'remove') after.memberships.shift();
    else after.memberships[0].grantor = 'baci_runner';
    assert.throws(() =>
      assertHostedSavingsAuthPreserved(
        JSON.stringify(before),
        JSON.stringify(after),
        allowed
      )
    );
  }
});

test('rejects protected data or role drift and malformed fingerprints', () => {
  for (const field of ['roles', 'schema'] as const) {
    const { before, after } = fixture();
    after[field] = 'changed';
    assert.throws(() =>
      assertHostedSavingsAuthPreserved(
        JSON.stringify(before),
        JSON.stringify(after),
        allowed
      )
    );
  }
  const { before, after } = fixture();
  after.data.users = 'changed';
  assert.throws(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after),
      allowed
    )
  );
  assert.throws(() => assertHostedSavingsAuthPreserved('{}', '{}', allowed));
});

function supabaseGrantFixture() {
  const before = baseline();
  before.principals.push({
    ...principal('supabase_admin', 10),
    superuser: true,
  });
  const after = structuredClone(before);
  after.principals.push(principal('repair_pickup_receiver'));
  after.memberships.push({
    ...edge('repair_pickup_receiver', 'authenticator'),
    grantor: 'supabase_admin',
    inheritOption: false,
  });
  const review = [{ role: 'repair_pickup_receiver', member: 'authenticator' }];
  return { before, after, review };
}

test('accepts ordinal987 exact Supabase bootstrap-superuser grant with unchanged protected principals', () => {
  const { before, after, review } = supabaseGrantFixture();
  assert.doesNotThrow(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after),
      review
    )
  );
  assert.throws(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after)
    )
  );
});

test('rejects untrusted or changed grantor and option escalation for the exact Supabase repair grant', () => {
  for (const variation of [
    'missing-original',
    'wrong-bootstrap-oid',
    'changed-oid',
    'not-superuser',
    'changed',
    'other-grantor',
    'admin',
    'inherit',
    'unset',
    'elevated-repair',
    'reverse',
  ]) {
    const { before, after, review } = supabaseGrantFixture();
    const grant = after.memberships[1];
    if (variation === 'missing-original') before.principals.pop();
    if (variation === 'wrong-bootstrap-oid') {
      before.principals[2].oid = 11;
      after.principals[2].oid = 11;
    }
    if (variation === 'changed-oid') after.principals[2].oid = 11;
    if (variation === 'not-superuser') {
      before.principals[2].superuser = false;
      after.principals[2].superuser = false;
    }
    if (variation === 'changed') after.principals[2].createRole = true;
    if (variation === 'other-grantor') grant.grantor = 'other_admin';
    if (variation === 'admin') grant.adminOption = true;
    if (variation === 'inherit') grant.inheritOption = true;
    if (variation === 'unset') grant.setOption = false;
    if (variation === 'elevated-repair') after.principals[3].bypassRls = true;
    if (variation === 'reverse') {
      grant.role = 'authenticator';
      grant.member = 'repair_pickup_receiver';
      review[0] = { role: grant.role, member: grant.member };
    }
    assert.throws(
      () =>
        assertHostedSavingsAuthPreserved(
          JSON.stringify(before),
          JSON.stringify(after),
          review
        ),
      variation
    );
  }
});

test('does not infer bootstrap identity from the supabase_admin name when OID evidence is missing', () => {
  const { before, after, review } = supabaseGrantFixture();
  delete before.principals[2].oid;
  delete after.principals[2].oid;
  assert.throws(() =>
    assertHostedSavingsAuthPreserved(
      JSON.stringify(before),
      JSON.stringify(after),
      review
    )
  );
});
