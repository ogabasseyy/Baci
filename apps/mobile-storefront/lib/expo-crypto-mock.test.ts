const cryptoMock = jest.requireActual<{
  CryptoDigestAlgorithm: { SHA256: string };
  CryptoEncoding: { UTF8: string; HEX: string };
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
it('honors UTF8 digest encoding instead of silently returning hex', async () => {
  const utf8 = await cryptoMock.digestStringAsync(
    cryptoMock.CryptoDigestAlgorithm.SHA256,
    'fixture',
    { encoding: cryptoMock.CryptoEncoding.UTF8 }
  );
  const hex = await cryptoMock.digestStringAsync(
    cryptoMock.CryptoDigestAlgorithm.SHA256,
    'fixture'
  );
  expect(utf8).not.toBe(hex);
  expect(utf8).not.toMatch(/^[0-9a-f]{64}$/);
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
