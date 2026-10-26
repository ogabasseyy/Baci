import { expect, it } from 'vitest';
import { GuestOAuth } from './guest-oauth';
import { GuestOAuthStorageError } from './guest-oauth-records';
import { fixture, request, verifier } from './guest-oauth.test-support';

it('recovers a committed refresh whose response was lost after restart', async () => {
  const { auth, options } = fixture();
  const { code } = await auth.authorize(request);
  const first = await auth.exchange({ ...request, code, code_verifier: verifier });
  const compare = options.store.compareAndSwap.bind(options.store);
  let drop = true;
  options.store.compareAndSwap = async (...args) => {
    const committed = await compare(...args);
    if (drop && committed && args[0].startsWith('grant:')) {
      drop = false;
      throw new GuestOAuthStorageError();
    }
    return committed;
  };
  await expect(auth.refresh({ ...request, refresh_token: first.refresh_token })).rejects.toThrow('storage');
  const restarted = new GuestOAuth(options);
  const recovered = await restarted.refresh({ ...request, refresh_token: first.refresh_token });
  await expect(restarted.verify(recovered.access_token)).resolves.toHaveProperty('id');
  const duplicate = await restarted.refresh({ ...request, refresh_token: first.refresh_token });
  expect(duplicate).toEqual(recovered);
});
it('limits refresh recovery to the immediate generation and a short grace', async () => {
  const { auth, advance } = fixture();
  const { code } = await auth.authorize(request);
  const first = await auth.exchange({ ...request, code, code_verifier: verifier });
  const next = await auth.refresh({ ...request, refresh_token: first.refresh_token });
  expect(await auth.refresh({ ...request, refresh_token: first.refresh_token })).toEqual(next);
  advance(31_000);
  await expect(auth.refresh({ ...request, refresh_token: first.refresh_token })).rejects.toThrow('invalid_grant');
  await expect(auth.verify(next.access_token)).rejects.toThrow('invalid_grant');
});
it('checks retained-grant admission before writing a new access record', async () => {
  const { auth, options, rows } = fixture();
  const { code } = await auth.authorize(request);
  const compare = options.store.compareAndSwap.bind(options.store);
  options.store.compareAndSwap = async (...args) => {
    if (args[0].startsWith('grant:') && args[1] === 0) throw new GuestOAuthStorageError();
    return compare(...args);
  };
  await expect(auth.exchange({ ...request, code, code_verifier: verifier })).rejects.toThrow('storage');
  expect([...rows.keys()].filter((key) => key.startsWith('access:'))).toHaveLength(0);
});
