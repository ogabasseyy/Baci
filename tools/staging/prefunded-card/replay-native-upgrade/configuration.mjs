import { isDeepStrictEqual } from 'node:util';
import { authority } from './constants.mjs';

const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');

export function prepareConfiguration({ baseBytes, privateBytes, newBundleSha256 }) {
  try {
    if (!Buffer.isBuffer(baseBytes) || !Buffer.isBuffer(privateBytes)
        || baseBytes.length > 32768 || privateBytes.length > 131072
        || !/^[a-f0-9]{64}$/.test(newBundleSha256)) throw new Error();
    const base = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(baseBytes));
    const settings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(privateBytes));
    if (!shape(base, ['environment', 'receiptSystemId', 'appSystemId', 'receiptKey',
      'receiptToken', 'appToken', 'prefundedReplay']) || base.environment !== 'staging'
        || base.appSystemId !== authority.system || base.receiptSystemId !== authority.receiptSystem
        || !isDeepStrictEqual(base.prefundedReplay, { bundleSha256: authority.predecessors.bundle,
          configurationSha256: authority.predecessors.private })
        || typeof base.receiptKey !== 'string'
        || Buffer.from(base.receiptKey, 'base64').length !== 32
        || Buffer.from(base.receiptKey, 'base64').toString('base64') !== base.receiptKey
        || !shape(settings, ['scope', 'evidence', 'database'])
        || !isDeepStrictEqual(settings.scope, authority.scope)
        || !shape(settings.database, ['treasury', 'ingestion'])) throw new Error();
    const now = Math.floor(Date.now() / 1000);
    if (now >= authority.deadlineEpoch) throw new Error();
    for (const [field, role, audience] of [
      ['receiptToken', 'pvb_staging_worker', 'pvb-staging-receipts'],
      ['appToken', 'pvb_staging_app_worker', 'authenticated'],
    ]) {
      const parts = typeof base[field] === 'string' ? base[field].split('.') : [];
      if (parts.length !== 3) throw new Error();
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!shape(claims, ['role', 'aud', 'iat', 'exp']) || claims.role !== role
          || claims.aud !== audience || claims.exp !== authority.deadlineEpoch
          || !Number.isInteger(claims.iat) || claims.iat > now + 60
          || claims.exp <= now || claims.exp - claims.iat <= 0
          || claims.exp - claims.iat > 604800) throw new Error();
    }
    const prepared = { ...base, prefundedReplay: { ...base.prefundedReplay, bundleSha256: newBundleSha256 } };
    return { 'config.json': Buffer.from(JSON.stringify(prepared)), 'prefunded.json': Buffer.from(privateBytes) };
  } catch {
    throw new Error('Replay configuration identity, six-field ABI or expiry refused');
  }
}
