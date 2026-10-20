import 'server-only';

interface ProviderRefund {
  // Decimal text, never a number: Paystack IDs are unsigned 64-bit
  // and a refund ID above 2^53 would not survive JSON.parse.
  id: string;
  amount: number;
  currency: string;
  status: string;
}

// Paystack transaction identities arrive as safe numbers, decimal text,
// or expanded objects carrying id/reference: collect every textual
// identity a value asserts. Unsafe numbers assert nothing (their text
// would already be corrupted), so those rows mismatch for review.
function identityTexts(value: unknown): string[] {
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return [String(value)];
  if (typeof value === 'string') return [value];
  if (typeof value === 'object' && value !== null) {
    const record = value as { id?: unknown; reference?: unknown };
    return [...identityTexts(record.id), ...identityTexts(record.reference)];
  }
  return [];
}

// Top-level data.id off the wire text, without assuming member
// order and without matching nested ids (expanded transaction or
// customer objects). Iterative cursor scan: strings are skipped
// with escape handling, values with a bracket stack, so no input
// shape recurses or misreads a quoted brace. Returns the raw
// digits (bare or quoted) or null when absent or malformed.
function readWireDataId(raw: string): string | null {
  let i = 0;
  const ws = (): void => {
    while (i < raw.length && /\s/.test(raw[i] ?? '')) i++;
  };
  // Decoded string contents, advancing past the closing quote;
  // null when unterminated or on a bad unicode escape.
  const str = (): string | null => {
    let out = '';
    i++;
    while (i < raw.length) {
      const c = raw[i] ?? '';
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\' && i + 1 < raw.length) {
        const e = raw[i + 1] ?? '';
        if (e === 'u') {
          const code = Number.parseInt(raw.slice(i + 2, i + 6), 16);
          if (Number.isNaN(code)) return null;
          out += String.fromCharCode(code);
          i += 6;
        } else {
          out +=
            (
              {
                '"': '"',
                '\\': '\\',
                '/': '/',
                b: '\b',
                f: '\f',
                n: '\n',
                r: '\r',
                t: '\t',
              } as Record<string, string>
            )[e] ?? e;
          i += 2;
        }
        continue;
      }
      out += c;
      i++;
    }
    return null;
  };
  // Skip any JSON value starting at i; false when malformed.
  const skip = (): boolean => {
    ws();
    const c = raw[i] ?? '';
    if (c === '"') return str() !== null;
    if (c === '{' || c === '[') {
      const stack = [c];
      i++;
      while (i < raw.length && stack.length > 0) {
        const d = raw[i] ?? '';
        if (d === '"') {
          if (str() === null) return false;
          continue;
        }
        if (d === '{' || d === '[') stack.push(d);
        else if (d === '}' || d === ']') {
          const open = stack.pop();
          if ((d === '}' && open !== '{') || (d === ']' && open !== '['))
            return false;
        }
        i++;
      }
      return stack.length === 0;
    }
    if (c === '') return false;
    while (i < raw.length && !/[,}\]:\s]/.test(raw[i] ?? '')) i++;
    return true;
  };
  // Value start of a direct member of the object raw[i] opens;
  // -1 when absent or malformed.
  const member = (name: string): number => {
    if ((raw[i] ?? '') !== '{') return -1;
    i++;
    for (;;) {
      ws();
      if ((raw[i] ?? '') !== '"') return -1;
      const key = str();
      if (key === null) return -1;
      ws();
      if ((raw[i] ?? '') !== ':') return -1;
      i++;
      ws();
      if (key === name) return i;
      if (!skip()) return -1;
      ws();
      if ((raw[i] ?? '') !== ',') return -1;
      i++;
    }
  };
  ws();
  const dataAt = member('data');
  if (dataAt < 0) return null;
  i = dataAt;
  const idAt = member('id');
  if (idAt < 0) return null;
  // Bare digits or a quoted decimal string; a nested value, null,
  // or boolean fails closed.
  const m = /^(?:"(\d+)"|(\d+))/.exec(raw.slice(idAt));
  return m?.[1] ?? m?.[2] ?? null;
}

export async function listPaystackRefunds(
  reference: string,
  options: { deadlineMs?: number } = {}
): Promise<ProviderRefund[]> {
  // The reference travels only through encodeURIComponent into a query
  // string, so punctuation is safe: reject empties, oversize values, and
  // control characters that could smuggle log or cache-key forgeries.
  const hasControlCharacter = [...reference].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
  if (reference.length < 1 || reference.length > 100 || hasControlCharacter)
    throw new Error('Invalid payment reference');
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error('Paystack refund verification unavailable');
  // Bare numeric IDs above 2^53 would not survive JSON.parse:
  // quote the transaction and row-id keys on the wire text before
  // parsing so the identity check below compares exact decimal text.
  // Nested IDs (expanded transaction/customer objects) quote too;
  // the identity collector accepts decimal text either way. Amount
  // stays numeric: kobo values cannot approach 2^53.
  const quoteWireRefundIds = (raw: string): string =>
    raw
      .replace(/"transaction"\s*:\s*(\d+)/g, '"transaction":"$1"')
      .replace(/"id"\s*:\s*(\d+)/g, '"id":"$1"');
  async function request(
    path: string,
    preprocess: (raw: string) => string = (raw) => raw
  ): Promise<{ payload: Record<string, unknown>; raw: string }> {
    // Recompute the cap from the absolute deadline before every
    // request: a timeout computed once would let each of the 20
    // list pages spend the full budget again, consuming the window
    // initiation needs. Recomputing bounds the whole list by the
    // remaining budget instead.
    const timeoutMs =
      options.deadlineMs === undefined
        ? 15_000
        : Math.max(1, Math.min(15_000, options.deadlineMs - Date.now()));
    const response = await fetch(`https://api.paystack.co${path}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error('Paystack refund verification failed');
    const raw = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(preprocess(raw)) as Record<string, unknown>;
    } catch {
      throw new Error('Paystack refund verification failed');
    }
    if (payload?.status !== true)
      throw new Error('Paystack refund verification failed');
    return { payload, raw };
  }
  // List Refunds filters by numeric transaction ID, not by reference: an
  // alphanumeric reference in that filter matches zero rows, blinding the
  // pre-check to existing provider refunds. Resolve the ID first, kept as
  // decimal text: Paystack IDs are unsigned 64-bit, beyond the safe
  // integer range, so a numeric parse would corrupt large IDs.
  const verified = await request(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
  // Read the ID off the wire text, not the parsed payload: JSON.parse
  // rounds integers past 2^53, so parsing first would corrupt a large
  // ID and then reject it as unsafe. Member order is not
  // contractual, so scan structurally for the top-level data object
  // and its direct id member; nested ids never match, and anything
  // else fails closed like before.
  const wireText = readWireDataId(verified.raw);
  const transactionId =
    wireText !== null && /^[1-9][0-9]*$/.test(wireText) ? wireText : null;
  if (transactionId === null) throw new Error('Unverified refund transaction');
  const refunds: ProviderRefund[] = [];
  for (let page = 1; page <= 20; page++) {
    const envelope = (
      await request(
        `/refund?transaction=${transactionId}&perPage=100&page=${page}`,
        quoteWireRefundIds
      )
    ).payload;
    if (!Array.isArray(envelope.data))
      throw new Error('Unverified refund list');
    const rows = envelope.data;
    for (const candidate of rows) {
      // The row ID arrives quoted off the wire text, so a numeric
      // ID here means the rewrite missed it: reject rather than
      // trust possibly rounded digits.
      if (
        !candidate ||
        typeof candidate.id !== 'string' ||
        !/^[1-9][0-9]*$/.test(candidate.id) ||
        !Number.isSafeInteger(candidate.amount) ||
        candidate.amount <= 0 ||
        typeof candidate.currency !== 'string' ||
        ![
          'processed',
          'pending',
          'processing',
          'needs-attention',
          'failed',
        ].includes(candidate.status)
      )
        throw new Error('Unverified refund record');
      // The server-side filter already scopes rows to this transaction;
      // this identity check only guards against a provider filter fault.
      // Rows carry the transaction as an expanded object, a bare numeric
      // ID, or (legacy) the reference string.
      const linked = candidate.transaction;
      const matches = identityTexts(linked).some(
        (text) => text === transactionId || text === reference
      );
      if (!matches) throw new Error('Refund transaction mismatch');
      refunds.push({
        id: candidate.id,
        amount: candidate.amount,
        currency: candidate.currency,
        status: candidate.status,
      });
    }
    // A full page is not proof that all refunds were read.
    if (envelope.data.length < 100) return refunds;
  }
  throw new Error('Refund pagination requires review');
}
