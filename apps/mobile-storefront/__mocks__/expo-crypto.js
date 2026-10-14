// Node-backed stand-in for the native expo-crypto module. The real
// module loads expo-asset/expo-constants copies that crash in Jest
// (EXDevLauncher undefined) for any suite that imports app code using
// Crypto without registering its own factory mock. Test files with an
// explicit jest.mock('expo-crypto', factory) keep their factory.
const { createHash, randomBytes, randomUUID } = require('node:crypto');

const CryptoDigestAlgorithm = {
  MD2: 'MD2',
  MD4: 'MD4',
  MD5: 'MD5',
  SHA1: 'SHA-1',
  SHA224: 'SHA-224',
  SHA256: 'SHA-256',
  SHA384: 'SHA-384',
  SHA512: 'SHA-512',
};

const hashNames = {
  MD5: 'md5',
  'SHA-1': 'sha1',
  'SHA-224': 'sha224',
  'SHA-256': 'sha256',
  'SHA-384': 'sha384',
  'SHA-512': 'sha512',
};

module.exports = {
  CryptoDigestAlgorithm,
  CryptoEncoding: { BASE64: 'base64', HEX: 'hex', UTF8: 'utf8' },
  randomUUID,
  getRandomBytes: (byteCount) => new Uint8Array(randomBytes(byteCount)),
  getRandomBytesAsync: async (byteCount) =>
    new Uint8Array(randomBytes(byteCount)),
  digestStringAsync: async (algorithm, data, options) => {
    const name = hashNames[algorithm];
    if (!name) throw new Error('Unsupported digest algorithm');
    const digest = createHash(name).update(String(data)).digest();
    return options?.encoding === 'base64'
      ? digest.toString('base64')
      : digest.toString('hex');
  },
  digest: async (algorithm, data) => {
    const name = hashNames[algorithm];
    if (!name) throw new Error('Unsupported digest algorithm');
    const buffer = createHash(name).update(Buffer.from(data)).digest();
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
  },
};
