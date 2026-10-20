const cryptoMock = jest.requireActual<{
  CryptoDigestAlgorithm: { SHA256: string };
  CryptoEncoding: { BASE64: string; HEX: string };
  digestStringAsync: (
    algorithm: string,
    value: string,
    options?: { encoding?: string }
  ) => Promise<string>;
}>('../__mocks__/expo-crypto.js');
it('does not silently substitute SHA256 for an unsupported digest algorithm', async () => {
  await expect(
    cryptoMock.digestStringAsync('not-supported', 'fixture')
  ).rejects.toThrow();
});
it('does not advertise UTF8 and rejects it like the native module', async () => {
  expect('UTF8' in cryptoMock.CryptoEncoding).toBe(false);
  await expect(
    cryptoMock.digestStringAsync(
      cryptoMock.CryptoDigestAlgorithm.SHA256,
      'fixture',
      {
        encoding: 'utf8',
      }
    )
  ).rejects.toThrow('Unsupported digest encoding');
});
it('rejects an unknown digest encoding instead of guessing', async () => {
  await expect(
    cryptoMock.digestStringAsync(
      cryptoMock.CryptoDigestAlgorithm.SHA256,
      'fixture',
      { encoding: 'bogus' }
    )
  ).rejects.toThrow('Unsupported digest encoding');
});
