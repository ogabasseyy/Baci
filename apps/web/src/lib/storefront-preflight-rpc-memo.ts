const MEMO_TTL_MS = 3_000;
const MEMO_MAX_ENTRIES = 512;

const memo = new Map<string, { expires: number; row: unknown }>();
const TIMEOUT_MEMO = Symbol('storefront-preflight-timeout');
const EMPTY_RESULT_MEMO = Symbol('storefront-preflight-empty-result');

function memoKey(
  fn: string,
  args: Record<string, string>,
  emptyResult: 'unknown' | undefined
): string {
  return JSON.stringify([
    fn,
    Object.keys(args)
      .sort()
      .map((key) => [key, args[key]]),
    emptyResult,
  ]);
}

function read(key: string): unknown | undefined {
  const entry = memo.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    memo.delete(key);
    return undefined;
  }
  return entry.row;
}

function write(key: string, row: unknown): void {
  if (memo.size >= MEMO_MAX_ENTRIES) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(key, { expires: Date.now() + MEMO_TTL_MS, row });
}

function clear(): void {
  memo.clear();
}

export const storefrontPreflightRpcMemo = {
  clear,
  emptyResult: EMPTY_RESULT_MEMO,
  isEmptyResult: (value: unknown) => value === EMPTY_RESULT_MEMO,
  isTimeout: (value: unknown) => value === TIMEOUT_MEMO,
  key: memoKey,
  read,
  timeout: TIMEOUT_MEMO,
  write,
};
