export function createFixture(variant: 'green' | 'blue', failConsent: boolean) {
  const goalId =
    variant === 'green'
      ? '10000000-0000-4000-8000-000000000001'
      : '10000000-0000-4000-8000-000000000002';
  const draft = {
    status: 'draft' as const,
    durationMonths: variant === 'green' ? 1 : 3,
    goalId,
    revisionId: '20000000-0000-4000-8000-000000000001',
    device: {
      productName: 'Synthetic QA phone — not a catalogue offer',
      variant: variant === 'green' ? '128 GB / Green' : '256 GB / Blue',
      condition: variant === 'green' ? 'Used — excellent' : 'New',
    },
    terms: {
      version: 'synthetic-qa-v1',
      hash: 'a'.repeat(64),
      text: 'SYNTHETIC QA TERMS — NOT A CUSTOMER AGREEMENT.\nThis fixture tests consent presentation only. The checkbox changes browser memory only. No plan, funding instruction, purchase, or financial protection is created.',
    },
    consent: 'required' as 'required' | 'accepted',
  };
  return {
    draft,
    async load(_goalId: string, signal: AbortSignal) {
      await delay(signal);
      return draft;
    },
    async submit(input: {
      goalId: string;
      revisionId: string;
      termsHash: string;
      termsVersion: string;
      accepted: true;
      durationMonths?: number;
    }) {
      await delay();
      if (
        failConsent ||
        input.goalId !== goalId ||
        input.revisionId !== draft.revisionId ||
        input.termsHash !== draft.terms.hash ||
        input.termsVersion !== draft.terms.version ||
        input.durationMonths !== draft.durationMonths ||
        input.accepted !== true
      ) {
        throw new Error('Synthetic acceptance failure');
      }
      return { ...draft, consent: 'accepted' as const };
    },
  };
}

export function fundingLoader(status: 'ready' | 'pending' | 'unavailable') {
  return async (_requestKey: string, signal: AbortSignal) => {
    await delay(signal);
    return status === 'ready'
      ? {
          status,
          accounts: [
            {
              accountNumber: 'NOT-A-BANK-ACCOUNT',
              accountName: 'SYNTHETIC QA ONLY',
              bankName: 'NO REAL BANK — TEST FIXTURE',
            },
          ],
        }
      : { status };
  };
}

function delay(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Synthetic request aborted'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Synthetic request aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 450);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
