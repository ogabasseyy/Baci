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
  jest.doMock('expo-secure-store', () => ({ getItemAsync, setItemAsync }));
  jest.doMock('expo-crypto', () => ({
    randomUUID: () => require('node:crypto').randomUUID(),
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

  it('exposes the credential under the shared header name', async () => {
    const { cartClientCredentialHeaders, getCartClientCredential } =
      loadModule();
    const credential = await getCartClientCredential();
    expect(await cartClientCredentialHeaders()).toEqual({
      'x-baci-client-credential': credential,
    });
  });
});
