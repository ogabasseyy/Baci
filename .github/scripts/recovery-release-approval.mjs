export function parseRecoveryReleaseApproval(args) {
  const required = '--approve-production --approve-prebuilt-fallback';
  const text = args.join(' ');
  if (text === required) return false;
  if (text === `${required} --approve-recovery-gate-reconciliation`) return true;
  throw new Error(`requires ${required} with optional --approve-recovery-gate-reconciliation; never run from a publishing workflow`);
}

export function recoveryReconciliationDispatchFields(approved) {
  return approved ? ['-f', 'reconcile_checkout_recovery_legacy=true'] : [];
}
