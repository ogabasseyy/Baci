// One definition of "this text runs a money operation", shared by the
// evaluator (money-pr-assurance-config.mjs) and the contract sweep
// (money-pr-assurance-coverage.test.mjs) so the two cannot drift apart.

// A database function moves or holds money when its name names a money
// noun. Pure reads (get_, list_, ...) are left out.
const MONEY_NOUN =
  /wallet|savings|piggyvest|store_?credit|prefund|primary_(?:card|bank|inflow|interest)|plan_transfer|refund|payout|payment|vtu|airtime|imei|petrock|loyalty|ledger|settle|withdraw|debit|bnpl|klump|redvault|credit_direct|shipping_charge/i;
const READ_ONLY = /^(?:get|list|count|search|read|is|has|can)_/i;
const RPC_CALL = /\.rpc\s*(?:<[^>]*>)?\s*\(\s*['"`]([a-z0-9_]+)['"`]/gi;
const SQL_FUNCTION =
  /create\s+(?:or\s+replace\s+)?function\s+(?:[a-z_]+\.)?"?([a-z0-9_]+)/gi;
// A call to one of the app's own money endpoints, from any client.
const MONEY_ROUTE =
  /['"`]\/api\/(?:[a-z0-9[\]-]+\/)*(?:wallet|savings|piggyvest|payments?|payouts?|refunds?|vtu|imei-check|loyalty)(?:[/?'"`$]|-)/i;

export const CODE = /\.(?:ts|tsx|js|jsx|mjs|cjs|sql|py|sh)$/;
// Tests, fixtures and generated types describe money code without running
// it; route tables name money routes without calling them.
export const NOT_RUNTIME = [
  /(?:^|\/)(?:__tests__|tests?|test-support|fixtures?|__mocks__)\//,
  /\.(?:test|spec|test-support|test-utils|test-fixtures)\.[a-z]+$/,
  /^apps\/web\/src\/types\/supabase\.ts$/,
  /^apps\/web\/src\/lib\/(?:proxy\/|rate-limit)/,
  /^docs\//,
];

export function isRuntimeCode(path) {
  return CODE.test(path) && !NOT_RUNTIME.some((pattern) => pattern.test(path));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole words and identifier parts only: `debit_merchant_balance` and
// "Transfers" match `debit`, `balance` and `transfer`; `discharged`,
// `created` and `balanced_tree` do not, nor does any other substring.
export function hasMoneyWord(text, words) {
  if (words.length === 0) return false;
  const alternatives = words.map(escapeRegExp).join('|');
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])(?:${alternatives})(?:s|es|d|ed|red|ing|ring)?(?=$|[^a-z0-9])`,
    'i'
  );
  return pattern.test(text.replaceAll('_', ' '));
}

// The lines a diff adds or removes, without their markers.
export function changedText(patch) {
  return patch
    .split('\n')
    .filter(
      (line) =>
        (line.startsWith('+') && !line.startsWith('+++')) ||
        (line.startsWith('-') && !line.startsWith('---'))
    )
    .map((line) => line.slice(1))
    .join('\n');
}

function moneyFunction(name, words) {
  if (READ_ONLY.test(name)) return false;
  return MONEY_NOUN.test(name) || hasMoneyWord(name, words);
}

// The first money operation in the text (a database money function it calls
// or defines, or a money endpoint it calls), or null.
export function moneyOperation(text, words = []) {
  for (const pattern of [RPC_CALL, SQL_FUNCTION]) {
    for (const [, name] of text.matchAll(pattern)) {
      if (moneyFunction(name, words)) return name;
    }
  }
  return MONEY_ROUTE.exec(text)?.[0] ?? null;
}
