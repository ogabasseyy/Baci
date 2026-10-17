const cryptoMock = jest.requireActual<{
  digestStringAsync: (algorithm: string, value: string) => Promise<string>;
}>('../__mocks__/expo-crypto.js');
it('does not silently substitute SHA256 for an unsupported digest algorithm', async () => {
  await expect(
    cryptoMock.digestStringAsync('not-supported', 'fixture')
  ).rejects.toThrow();
});
