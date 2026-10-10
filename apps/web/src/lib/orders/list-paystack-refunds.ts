import 'server-only';

interface ProviderRefund {
  id: number;
  amount: number;
  currency: string;
  status: string;
}

export async function listPaystackRefunds(
  reference: string
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
  async function request(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(`https://api.paystack.co${path}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Paystack refund verification failed');
    const payload = await response.json();
    if (payload?.status !== true)
      throw new Error('Paystack refund verification failed');
    return payload;
  }
  // List Refunds filters by numeric transaction ID, not by reference: an
  // alphanumeric reference in that filter matches zero rows, blinding the
  // pre-check to existing provider refunds. Resolve the ID first.
  const verified = await request(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
  const verifiedId = (verified.data as { id?: unknown } | null)?.id;
  if (
    typeof verifiedId !== 'number' ||
    !Number.isSafeInteger(verifiedId) ||
    verifiedId <= 0
  )
    throw new Error('Unverified refund transaction');
  const transactionId: number = verifiedId;
  const refunds: ProviderRefund[] = [];
  for (let page = 1; page <= 20; page++) {
    const envelope = await request(
      `/refund?transaction=${transactionId}&perPage=100&page=${page}`
    );
    if (!Array.isArray(envelope.data))
      throw new Error('Unverified refund list');
    const rows = envelope.data;
    for (const candidate of rows) {
      if (
        !candidate ||
        !Number.isSafeInteger(candidate.id) ||
        candidate.id <= 0 ||
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
      const matches =
        linked === transactionId ||
        linked === reference ||
        linked === String(transactionId) ||
        (typeof linked === 'object' &&
          linked !== null &&
          (linked.id === transactionId || linked.reference === reference));
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
