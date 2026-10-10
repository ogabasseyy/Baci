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
  if (!/^[A-Za-z0-9.=_-]{1,100}$/.test(reference))
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
  const refunds: ProviderRefund[] = [];
  for (let page = 1; page <= 20; page++) {
    const envelope = await request(
      `/refund?transaction=${encodeURIComponent(reference)}&perPage=100&page=${page}`
    );
    if (!Array.isArray(envelope.data))
      throw new Error('Unverified refund list');
    const rows = envelope.data;
    const linkedReferences: Array<string | undefined> = new Array(rows.length);
    const unresolved: number[] = [];
    for (let index = 0; index < rows.length; index++) {
      const candidate = rows[index];
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
      if (typeof candidate.transaction === 'string') {
        linkedReferences[index] = candidate.transaction;
      } else if (
        typeof candidate.transaction === 'number' &&
        Number.isSafeInteger(candidate.transaction) &&
        candidate.transaction > 0
      ) {
        unresolved.push(index);
      } else {
        linkedReferences[index] = candidate.transaction?.reference;
      }
    }
    // Numeric transaction identities resolve with bounded concurrency: a
    // page of 100 sequential 15s-timeout lookups would stall the worker.
    const workers = Array.from(
      { length: Math.min(5, unresolved.length) },
      async () => {
        while (unresolved.length > 0) {
          const index = unresolved.shift();
          if (index === undefined) return;
          const candidate = rows[index];
          const transaction = await request(
            `/transaction/${candidate.transaction}`
          );
          const data = transaction.data as { reference?: string } | null;
          linkedReferences[index] = data?.reference;
        }
      }
    );
    await Promise.all(workers);
    for (let index = 0; index < rows.length; index++) {
      const candidate = rows[index];
      if (linkedReferences[index] !== reference)
        throw new Error('Refund transaction mismatch');
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
