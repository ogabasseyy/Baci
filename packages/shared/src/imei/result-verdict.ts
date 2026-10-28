export function getImeiFinanceState(
  value: string | null | undefined
): 'unchecked' | 'clear' | 'risk' | 'unknown' {
  const status = value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  if (!status) return 'unchecked';
  const clauses = status.split(/\s*[/,;&|]\s*/);
  const risk = new Set([
    'past due',
    'overdue',
    'unpaid',
    'not paid',
    'outstanding',
    'outstanding balance',
  ]);
  const clear = new Set([
    'clean',
    'clear',
    'paid',
    'paid off',
    'fully paid',
    'paid in full',
    'no outstanding balance',
    'no finance',
  ]);
  if (clauses.some((clause) => risk.has(clause))) return 'risk';
  return clauses.every((clause) => clear.has(clause)) ? 'clear' : 'unknown';
}

/** Prevent older contradictory cached reports from presenting a safe verdict. */
export function getImeiEffectiveVerdict(result: {
  status: string;
  verdictType: string;
  verdict: string;
  financeStatus?: string | null;
}): { type: 'safe' | 'caution' | 'danger'; text: string } {
  if (result.verdictType === 'danger')
    return { type: 'danger', text: result.verdict };
  if (result.status === 'Blacklisted')
    return {
      type: 'danger',
      text: 'Blacklist risk detected. Verify this report before buying.',
    };
  if (result.verdictType === 'caution')
    return { type: 'caution', text: result.verdict };
  const finance = getImeiFinanceState(result.financeStatus);
  if (finance === 'risk')
    return {
      type: 'caution',
      text: 'The report indicates a finance balance or overdue payment. Confirm the account is clear before buying.',
    };
  if (finance === 'unknown')
    return {
      type: 'caution',
      text: 'The finance status is unclear. Verify it before buying.',
    };
  if (result.status !== 'Clean' || result.verdictType !== 'safe')
    return {
      type: 'caution',
      text: 'The report is incomplete. Verify the remaining checks before buying.',
    };
  return { type: 'safe', text: result.verdict };
}
