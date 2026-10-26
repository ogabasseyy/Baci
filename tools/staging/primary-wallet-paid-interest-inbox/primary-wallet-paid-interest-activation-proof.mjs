export function validatePrimaryInterestOperatorProof(proof, context) {
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
