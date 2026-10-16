import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import * as SecureStore from 'expo-secure-store';

const mockRouterCanDismiss = jest.fn();
const mockRouterDismiss = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterSetParams = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    canDismiss: mockRouterCanDismiss,
    dismiss: mockRouterDismiss,
    replace: mockRouterReplace,
    setParams: mockRouterSetParams,
  },
}));

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
  }),
}));

const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;

async function flushEmailHintLoader() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let dismissAuthenticatedLogin: typeof import('./login-screen-controller.helpers').dismissAuthenticatedLogin;
let fetchLoginEmailHintFromReturnTo: typeof import('./login-screen-controller.helpers').fetchLoginEmailHintFromReturnTo;
let getReceiptClaimTokenFromReturnTo: typeof import('./login-screen-controller.helpers').getReceiptClaimTokenFromReturnTo;
let getValidatedLoginEmailHint: typeof import('./login-screen-controller.helpers').getValidatedLoginEmailHint;
let loadLoginEmailHintFromReturnTo: typeof import('./login-screen-controller.helpers').loadLoginEmailHintFromReturnTo;
let normalizeEmail: typeof import('./login-screen-controller.helpers').normalizeEmail;
let validateLoginEmailInput: typeof import('./login-screen-controller.helpers').validateLoginEmailInput;

describe('login screen controller helpers', () => {
  beforeAll(async () => {
    const helpers = await import('./login-screen-controller.helpers');
    dismissAuthenticatedLogin = helpers.dismissAuthenticatedLogin;
    fetchLoginEmailHintFromReturnTo = helpers.fetchLoginEmailHintFromReturnTo;
    getReceiptClaimTokenFromReturnTo = helpers.getReceiptClaimTokenFromReturnTo;
    getValidatedLoginEmailHint = helpers.getValidatedLoginEmailHint;
    loadLoginEmailHintFromReturnTo = helpers.loadLoginEmailHintFromReturnTo;
    normalizeEmail = helpers.normalizeEmail;
    validateLoginEmailInput = helpers.validateLoginEmailInput;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouterCanDismiss.mockReturnValue(false);
    mockDeleteItemAsync.mockResolvedValue(undefined);
  });

  it('normalizes regular email input', () => {
    expect(normalizeEmail(' Shopper@Example.COM ')).toBe('shopper@example.com');
  });

  it('returns a sanitized email hint from a query parameter', () => {
    expect(getValidatedLoginEmailHint('  Shopper@Example.COM  ')).toBe(
      'shopper@example.com'
    );
  });

  it('ignores invalid email hints', () => {
    expect(getValidatedLoginEmailHint('https://evil.example')).toBe('');
    expect(getValidatedLoginEmailHint(undefined)).toBe('');
  });

  it('extracts receipt claim tokens from return paths', () => {
    expect(getReceiptClaimTokenFromReturnTo('/receipts/claim/token_123')).toBe(
      'token_123'
    );
    expect(
      getReceiptClaimTokenFromReturnTo(
        encodeURIComponent('/receipts/claim/token_123?from=email')
      )
    ).toBe('token_123');
    expect(getReceiptClaimTokenFromReturnTo('/receipts')).toBeNull();
  });

  it('loads and sanitizes the receipt claim email hint from return paths', async () => {
    const fetchImpl = jest.fn(async () => ({
      json: async () => ({ emailHint: '  Shopper@Example.COM  ' }),
      ok: true,
    })) as unknown as typeof fetch;

    await expect(
      fetchLoginEmailHintFromReturnTo('/receipts/claim/token_123', fetchImpl)
    ).resolves.toBe('shopper@example.com');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/receipts/claims/token_123/login-email',
      { headers: { accept: 'application/json' } }
    );
  });

  it('does not fetch email hints for non-claim return paths', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    await expect(
      fetchLoginEmailHintFromReturnTo('/receipts', fetchImpl)
    ).resolves.toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('loads a receipt claim email hint into empty login email state', async () => {
    const setEmail = jest.fn();
    const fetchImpl = jest.fn(async () => ({
      json: async () => ({ emailHint: '  Shopper@Example.COM  ' }),
      ok: true,
    })) as unknown as typeof fetch;

    loadLoginEmailHintFromReturnTo({
      currentEmail: '',
      fetchImpl,
      initialEmail: '',
      onError: jest.fn(),
      returnTo: '/receipts/claim/token_123',
      setEmail,
    });
    await flushEmailHintLoader();

    expect(setEmail).toHaveBeenCalledWith('shopper@example.com');
  });

  it('skips loading a receipt claim email hint when login already has email state', () => {
    const setEmail = jest.fn();
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    const cleanup = loadLoginEmailHintFromReturnTo({
      currentEmail: 'typed@example.com',
      fetchImpl,
      initialEmail: '',
      onError: jest.fn(),
      returnTo: '/receipts/claim/token_123',
      setEmail,
    });

    expect(cleanup).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(setEmail).not.toHaveBeenCalled();
  });

  it('ignores loaded email hints after cleanup', async () => {
    const setEmail = jest.fn();
    const fetchImpl = jest.fn(async () => ({
      json: async () => ({ emailHint: 'shopper@example.com' }),
      ok: true,
    })) as unknown as typeof fetch;

    const cleanup = loadLoginEmailHintFromReturnTo({
      currentEmail: '',
      fetchImpl,
      initialEmail: '',
      onError: jest.fn(),
      returnTo: '/receipts/claim/token_123',
      setEmail,
    });
    cleanup?.();
    await flushEmailHintLoader();

    expect(setEmail).not.toHaveBeenCalled();
  });

  it('validates login email input and returns the normalized email', () => {
    expect(validateLoginEmailInput(' Shopper@Example.COM ')).toEqual({
      error: null,
      normalizedEmail: 'shopper@example.com',
    });
    expect(validateLoginEmailInput('not-an-email').error).toBeTruthy();
  });

  it('replaces the route with the decoded return path after authenticated login', () => {
    dismissAuthenticatedLogin(encodeURIComponent('/receipts?tab=recent'));

    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith('/receipts?tab=recent');
    expect(mockRouterCanDismiss).not.toHaveBeenCalled();
    expect(mockRouterDismiss).not.toHaveBeenCalled();
  });

  it('falls back to the dismiss behavior for malformed return paths', () => {
    mockRouterCanDismiss.mockReturnValue(true);

    dismissAuthenticatedLogin('/receipts%');

    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
    expect(mockRouterCanDismiss).toHaveBeenCalledTimes(1);
    expect(mockRouterDismiss).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('falls back to the home route for unsafe return paths', () => {
    dismissAuthenticatedLogin(encodeURIComponent('https://evil.example'));

    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
    expect(mockRouterCanDismiss).toHaveBeenCalledTimes(1);
    expect(mockRouterDismiss).not.toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });

  it('dismisses the current route after authenticated login when possible', () => {
    mockRouterCanDismiss.mockReturnValue(true);

    dismissAuthenticatedLogin(undefined);

    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
    expect(mockRouterCanDismiss).toHaveBeenCalledTimes(1);
    expect(mockRouterDismiss).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('falls back to the home route when authenticated login cannot dismiss', () => {
    dismissAuthenticatedLogin(undefined);

    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(1);
    expect(mockRouterCanDismiss).toHaveBeenCalledTimes(1);
    expect(mockRouterDismiss).not.toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });
});
