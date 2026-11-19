import { GoalLifecycleSchemas as schemas } from './goal-lifecycle';

const ids = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
};
const proof = 'a'.repeat(64);

describe('requests are strict', () => {
  it('accepts the exact issue, submit and status bodies', () => {
    expect(
      schemas.issueRequest.safeParse({
        step: 'issue',
        merchantId: ids.merchantId,
        goalId: ids.goalId,
      }).success
    ).toBe(true);
    expect(
      schemas.submitRequest.safeParse({
        step: 'submit',
        ...ids,
        pinProof: proof,
      }).success
    ).toBe(true);
    expect(
      schemas.statusRequest.safeParse({
        merchantId: ids.merchantId,
        operationId: ids.operationId,
      }).success
    ).toBe(true);
  });

  it.each([
    [
      'issue with an amount',
      'issueRequest',
      {
        step: 'issue',
        merchantId: ids.merchantId,
        goalId: ids.goalId,
        amountKobo: 5,
      },
    ],
    [
      'issue with a bad goal id',
      'issueRequest',
      { step: 'issue', merchantId: ids.merchantId, goalId: 'g' },
    ],
    ['submit without a proof', 'submitRequest', { step: 'submit', ...ids }],
    [
      'submit with a short proof',
      'submitRequest',
      { step: 'submit', ...ids, pinProof: 'abc' },
    ],
    [
      'submit with an upper-case proof',
      'submitRequest',
      { step: 'submit', ...ids, pinProof: 'A'.repeat(64) },
    ],
    [
      'submit with a PIN',
      'submitRequest',
      { step: 'submit', ...ids, pinProof: proof, pin: '4821' },
    ],
    ['status with a goal id', 'statusRequest', { ...ids }],
  ] as const)('refuses %s', (_name, key, body) => {
    expect(schemas[key].safeParse(body).success).toBe(false);
  });

  it('never echoes a refused value in the issue message', () => {
    const result = schemas.submitRequest.safeParse({
      step: 'submit',
      ...ids,
      pinProof: 'secret-proof-value',
    });
    expect(JSON.stringify(result)).not.toContain('secret-proof-value');
  });
});

describe('responses', () => {
  it('reads issue answers per kind (only complete may answer confirmed)', () => {
    const body = (status: string) => ({
      status,
      operationId: ids.operationId,
    });
    expect(schemas.issueResponse.cancel.safeParse(body('issued')).success).toBe(
      true
    );
    expect(
      schemas.issueResponse.cancel.safeParse(body('pending')).success
    ).toBe(true);
    expect(
      schemas.issueResponse.cancel.safeParse(body('confirmed')).success
    ).toBe(false);
    expect(
      schemas.issueResponse.complete.safeParse(body('confirmed')).success
    ).toBe(true);
    expect(schemas.issueResponse.complete.safeParse(body('nope')).success).toBe(
      false
    );
  });

  it('reads submit and status answers and refuses a non-uuid operation id', () => {
    expect(
      schemas.submitResponse.safeParse({
        status: 'confirmed',
        operationId: ids.operationId,
      }).success
    ).toBe(true);
    expect(
      schemas.submitResponse.safeParse({
        status: 'needs_review',
        operationId: ids.operationId,
      }).success
    ).toBe(false);
    for (const status of [
      'pending',
      'confirmed',
      'needs_review',
      'not_started',
    ])
      expect(
        schemas.statusResponse.safeParse({
          status,
          operationId: ids.operationId,
        }).success
      ).toBe(true);
    expect(
      schemas.statusResponse.safeParse({ status: 'pending', operationId: 'x' })
        .success
    ).toBe(false);
  });
});
