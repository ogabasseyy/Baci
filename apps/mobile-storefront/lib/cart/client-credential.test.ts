const FIXED_UUID = '44444444-4444-4444-8444-444444444444';
const randomUUIDMock = jest.fn((): string => FIXED_UUID);
const storage = new Map<string, string>();
const getItemAsync = jest.fn(async (key: string) => storage.get(key) ?? null);
const setItemAsync = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

function loadModule() {
  return require('./client-credential') as typeof import('./client-credential');
}

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  getItemAsync.mockClear();
  setItemAsync.mockClear();
  getItemAsync.mockImplementation(
    async (key: string) => storage.get(key) ?? null
  );
  setItemAsync.mockImplementation(async (key: string, value: string) => {
    storage.set(key, value);
  });
  randomUUIDMock.mockImplementation((): string => FIXED_UUID);
  jest.doMock('expo-secure-store', () => ({ getItemAsync, setItemAsync }));
  jest.doMock('expo-crypto', () => ({
    randomUUID: randomUUIDMock,
  }));
});

const STORAGE_KEY = 'baci.cart.client-credential.ogabassey';

describe('getCartClientCredential', () => {
  it('generates once, persists per merchant, and reuses the credential', async () => {
    const { getCartClientCredential } = loadModule();
    const first = await getCartClientCredential('ogabassey');
    expect(first).toBe(FIXED_UUID);
    expect(storage.get(STORAGE_KEY)).toBe(first);
    expect(await getCartClientCredential('ogabassey')).toBe(first);
    expect(setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('scopes credentials per merchant so they are unlinkable across merchants', async () => {
    randomUUIDMock
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    const { getCartClientCredential } = loadModule();
    expect(await getCartClientCredential('ogabassey')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(await getCartClientCredential('second-store')).toBe(
      '22222222-2222-4222-8222-222222222222'
    );
    expect(storage.get('baci.cart.client-credential.ogabassey')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(storage.get('baci.cart.client-credential.second-store')).toBe(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('replaces a malformed stored value', async () => {
    storage.set(STORAGE_KEY, 'junk');
    const { getCartClientCredential } = loadModule();
    const credential = await getCartClientCredential('ogabassey');
    expect(credential).toBe(FIXED_UUID);
    expect(storage.get(STORAGE_KEY)).toBe(credential);
  });

  it('falls back to a stable in-memory credential when storage fails', async () => {
    getItemAsync.mockRejectedValue(new Error('denied'));
    const { getCartClientCredential } = loadModule();
    const first = await getCartClientCredential('ogabassey');
    expect(first).toBe(FIXED_UUID);
    expect(await getCartClientCredential('ogabassey')).toBe(first);
  });

  it('omits the header instead of rejecting when generation fails', async () => {
    getItemAsync.mockRejectedValue(new Error('denied'));
    randomUUIDMock.mockImplementation((): string => {
      throw new Error('unavailable');
    });
    const { cartClientCredentialHeaders, getCartClientCredential } =
      loadModule();
    await expect(getCartClientCredential('ogabassey')).resolves.toBeNull();
    // The settled (not rejected) result is cached, never a rejection.
    await expect(getCartClientCredential('ogabassey')).resolves.toBeNull();
    await expect(cartClientCredentialHeaders('ogabassey')).resolves.toEqual({});
  });

  it('exposes the credential under the shared header name', async () => {
    const { cartClientCredentialHeaders } = loadModule();
    expect(await cartClientCredentialHeaders('ogabassey')).toEqual({
      'x-baci-client-credential': FIXED_UUID,
    });
  });
});
