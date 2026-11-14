import {
  checkGoalActionStatus,
  issueGoalAction,
  submitGoalAction,
} from './goal-lifecycle-api';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const pinProof = 'b'.repeat(64);
const UNREADABLE =
  'We could not confirm this. Check its status before trying again.';

beforeEach(() => jest.clearAllMocks());

describe.each(['cancel', 'complete'] as const)('%s', (kind) => {
  const path = `/api/storefront/customer/savings/goal-${kind}`;

  it('issues with an exact POST, CSRF and the pinned user', async () => {
    mockFetchJson.mockResolvedValue({ status: 'issued', operationId });
    await expect(
      issueGoalAction(kind, { merchantId, goalId })
    ).resolves.toEqual({
      status: 'issued',
      operationId,
    });
    expect(mockFetchJson).toHaveBeenCalledWith({
      path,
      method: 'POST',
      includeCsrf: true,
      expectedUserId: 'user-a',
      body: {
        step: 'issue',
        merchantId,
        goalId,
        ...(kind === 'cancel' ? { interestForfeitAcknowledged: true } : {}),
      },
    });
  });

  it('pins to the caller-given user rather than whoever is signed in now', async () => {
    mockFetchJson.mockResolvedValue({ status: 'pending', operationId });
    await issueGoalAction(kind, { merchantId, goalId }, 'user-opened');
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUserId: 'user-opened' })
    );
  });

  it('submits with an exact POST body carrying the proof and no amount', async () => {
    mockFetchJson.mockResolvedValue({ status: 'pending', operationId });
    await expect(
      submitGoalAction(kind, { merchantId, goalId, operationId, pinProof })
    ).resolves.toEqual({ status: 'pending', operationId });
    expect(mockFetchJson).toHaveBeenCalledWith({
      path,
      method: 'POST',
      includeCsrf: true,
      expectedUserId: 'user-a',
      body: {
        step: 'submit',
        merchantId,
        goalId,
        operationId,
        pinProof,
        ...(kind === 'cancel' ? { interestForfeitAcknowledged: true } : {}),
      },
    });
  });

  it('checks status with an exact PATCH', async () => {
    mockFetchJson.mockResolvedValue({ status: 'needs_review', operationId });
    await expect(
      checkGoalActionStatus(kind, { merchantId, operationId })
    ).resolves.toEqual({ status: 'needs_review', operationId });
    expect(mockFetchJson).toHaveBeenCalledWith({
      path,
      method: 'PATCH',
      includeCsrf: true,
      expectedUserId: 'user-a',
      body: { merchantId, operationId },
    });
  });

  it.each([
    ['issue', () => issueGoalAction(kind, { merchantId, goalId })],
    [
      'submit',
      () =>
        submitGoalAction(kind, { merchantId, goalId, operationId, pinProof }),
    ],
    ['status', () => checkGoalActionStatus(kind, { merchantId, operationId })],
  ])('turns an unreadable %s reply into the generic error with no code', async (_step, run) => {
    mockFetchJson.mockResolvedValue({ status: 'weird' });
    const failure = await run().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(UNREADABLE);
    expect(failure).not.toHaveProperty('code');
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['issue', () => issueGoalAction(kind, { merchantId, goalId })],
    [
      'submit',
      () =>
        submitGoalAction(kind, { merchantId, goalId, operationId, pinProof }),
    ],
    ['status', () => checkGoalActionStatus(kind, { merchantId, operationId })],
  ])('rejects a %s reply for a different operation id', async (step, run) => {
    mockFetchJson.mockResolvedValue({
      status: step === 'issue' ? 'issued' : 'pending',
      operationId: '44444444-4444-4444-8444-444444444444',
    });
    if (step === 'issue') {
      // The id is server-issued: there is nothing to compare it with.
      await expect(run()).resolves.toMatchObject({ status: 'issued' });
      return;
    }
    await expect(run()).rejects.toThrow(UNREADABLE);
  });

  it('keeps the server code and message, and refuses a bad proof before sending', async () => {
    mockFetchJson.mockRejectedValue(
      Object.assign(new Error('A contribution is still processing.'), {
        code: `${kind.toUpperCase()}_BUSY`,
      })
    );
    await expect(
      issueGoalAction(kind, { merchantId, goalId })
    ).rejects.toMatchObject({
      code: `${kind.toUpperCase()}_BUSY`,
      message: 'A contribution is still processing.',
    });
    mockFetchJson.mockClear();
    await expect(
      submitGoalAction(kind, { merchantId, goalId, operationId, pinProof: 'x' })
    ).rejects.toBeDefined();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});

it('allows an already-confirmed answer to a complete issue only', async () => {
  mockFetchJson.mockResolvedValue({ status: 'confirmed', operationId });
  await expect(
    issueGoalAction('complete', { merchantId, goalId })
  ).resolves.toEqual({ status: 'confirmed', operationId });
  await expect(
    issueGoalAction('cancel', { merchantId, goalId })
  ).rejects.toThrow(UNREADABLE);
});
