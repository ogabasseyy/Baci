import { createHash } from 'node:crypto';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function inspectOperatorProof(proof, context) {
  if (!proof) return false;
  const allowed = [
    'kind',
    'capturedAt',
    'expiresAt',
    'hostInventorySha256',
    'databaseInventorySha256',
    'candidateBundleSha256',
    'providerContractProofSha256',
    'privilegedMigrationProofSha256',
    'exactProductionScopeVerified',
    'restrictedCapabilitiesVerified',
    'finiteCredentialExpiryVerified',
    'rollbackReviewed',
  ];
  if (
    Object.keys(proof).some((key) => !allowed.includes(key)) ||
    proof.kind !== 'operator_inventory' ||
    proof.hostInventorySha256 !== context.inventoryDigest ||
    proof.candidateBundleSha256 !== context.bundleDigest ||
    proof.databaseInventorySha256 !== context.databaseDigest ||
    !context.databaseReady ||
    ![
      'databaseInventorySha256',
      'providerContractProofSha256',
      'privilegedMigrationProofSha256',
    ].every((key) => /^[a-f0-9]{64}$/.test(proof[key] ?? '')) ||
    ![
      'exactProductionScopeVerified',
      'restrictedCapabilitiesVerified',
      'finiteCredentialExpiryVerified',
      'rollbackReviewed',
    ].every((key) => proof[key] === true)
  )
    throw new Error('Operator proof does not match the exact preparation');
  const captured = Date.parse(proof.capturedAt);
  const expires = Date.parse(proof.expiresAt);
  if (
    !Number.isFinite(captured) ||
    !Number.isFinite(expires) ||
    captured > context.now + 5000 ||
    context.now - captured > 3600000 ||
    expires <= context.now ||
    expires > context.expiry
  )
    throw new Error('Operator proof is stale or over-approved');
  return true;
}

export function validatePrimaryCustodyActivationProof({
  database,
  operatorProof,
  now,
  expiry,
  inventoryBytes,
  bundleDigest,
  expiresAt,
}) {
  const dbKeys = [
    'captured_at',
    'session_is_fixed_login',
    'tls',
    'login_restricted',
    'login_valid_until',
    'sole_capability_membership',
    'capability_restricted',
    'capability_parent_memberships',
    'schema_usage',
    'effective_primary_rpcs',
    'direct_private_table_privileges',
    'public_custody_rpcs',
    'custody_rpcs_present',
    'customer_or_service_custody_execution',
  ];
  if (
    database &&
    (Object.keys(database).some(
      (key) => !['restricted_inventory', 'authority_inventory'].includes(key)
    ) ||
      !database.restricted_inventory ||
      !database.authority_inventory ||
      Object.keys(database.restricted_inventory).some(
        (key) => !dbKeys.includes(key)
      ) ||
      Object.keys(database.authority_inventory).some(
        (key) =>
          !['exact_enabled_authority_ready', 'financial_actions'].includes(key)
      ))
  )
    throw new Error('Unsafe database inventory metadata');
  const db = database?.restricted_inventory;
  const credentialExpiry = Date.parse(db?.login_valid_until);
  const rpcNames = [
    'transfer_context',
    'settle_custody',
    'signed_inbox_readiness',
    'inbox_ready',
    'enqueue_signed_inbox',
    'claim_signed_inbox',
    'resolve_signed_reference',
    'finish_signed_inbox',
  ];
  const databaseReady =
    !!db &&
    [
      'session_is_fixed_login',
      'tls',
      'login_restricted',
      'sole_capability_membership',
      'capability_restricted',
      'schema_usage',
      'custody_rpcs_present',
    ].every((key) => db[key] === true) &&
    [
      'capability_parent_memberships',
      'direct_private_table_privileges',
      'public_custody_rpcs',
      'customer_or_service_custody_execution',
    ].every((key) => db[key] === 0) &&
    Number.isFinite(Date.parse(db.captured_at)) &&
    Date.parse(db.captured_at) <= now + 5000 &&
    now - Date.parse(db.captured_at) <= 3600000 &&
    Number.isFinite(credentialExpiry) &&
    credentialExpiry > now &&
    credentialExpiry <= expiry &&
    Array.isArray(db.effective_primary_rpcs) &&
    db.effective_primary_rpcs.length === 8 &&
    new Set(
      db.effective_primary_rpcs.map(
        (rpc) => typeof rpc === 'string' && rpc.slice(0, rpc.indexOf('('))
      )
    ).size === 8 &&
    db.effective_primary_rpcs.every(
      (rpc) =>
        typeof rpc === 'string' &&
        rpcNames.includes(rpc.slice(0, rpc.indexOf('(')))
    ) &&
    database.authority_inventory.exact_enabled_authority_ready === true &&
    database.authority_inventory.financial_actions === false;
  const databaseBytes = `${JSON.stringify(database ?? { status: 'not_supplied' }, null, 2)}\n`;
  const reviewed = inspectOperatorProof(operatorProof, {
    now,
    expiry,
    databaseReady,
    databaseDigest: digest(databaseBytes),
    inventoryDigest: digest(inventoryBytes),
    bundleDigest: bundleDigest,
  });
  const effectiveExpiry = reviewed
    ? new Date(
        Math.min(expiry, Date.parse(operatorProof.expiresAt))
      ).toISOString()
    : expiresAt;
  return { databaseBytes, reviewed, effectiveExpiry };
}
