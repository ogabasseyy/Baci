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

describe('getCartClientCredential', () => {
  it('generates once, persists, and reuses the credential', async () => {
    const { getCartClientCredential } = loadModule();
    const first = await getCartClientCredential();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(storage.get('baci.cart.client-credential')).toBe(first);
    expect(await getCartClientCredential()).toBe(first);
    expect(setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('replaces a malformed stored value', async () => {
    storage.set('baci.cart.client-credential', 'junk');
    const { getCartClientCredential } = loadModule();
    const credential = await getCartClientCredential();
    expect(credential).not.toBe('junk');
    expect(storage.get('baci.cart.client-credential')).toBe(credential);
  });

  it('falls back to a stable in-memory credential when storage fails', async () => {
    getItemAsync.mockRejectedValue(new Error('denied'));
    const { getCartClientCredential } = loadModule();
    const first = await getCartClientCredential();
    expect(await getCartClientCredential()).toBe(first);
  });

  it('omits the header instead of rejecting when generation fails', async () => {
    getItemAsync.mockRejectedValue(new Error('denied'));
    randomUUIDMock.mockImplementation((): string => {
      throw new Error('unavailable');
    });
    const { cartClientCredentialHeaders, getCartClientCredential } =
      loadModule();
    await expect(getCartClientCredential()).resolves.toBeNull();
    // The settled (not rejected) result is cached, never a rejection.
    await expect(getCartClientCredential()).resolves.toBeNull();
    await expect(cartClientCredentialHeaders()).resolves.toEqual({});
  });

  it('exposes the credential under the shared header name', async () => {
    const { cartClientCredentialHeaders, getCartClientCredential } =
      loadModule();
    const credential = await getCartClientCredential();
    expect(await cartClientCredentialHeaders()).toEqual({
      'x-baci-client-credential': credential,
    });
  });
});
