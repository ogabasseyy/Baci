import { expect, it, vi } from 'vitest';
import {
  composeLocalCsp,
  isLocalFixtureFetch,
  localHeaderSetter,
} from './local-process-policy.mjs';

it('keeps all existing protections while adding exactly the owned local gateway/Data API', () => {
  const policy =
    "default-src 'none'; script-src 'self'; frame-src 'self'; connect-src 'self'; form-action 'none'";
  const result = composeLocalCsp(policy, 'http://127.0.0.1:43210');
  expect(result).toBe(
    "default-src 'none'; script-src 'self'; frame-src 'self' http://127.0.0.1:43175; connect-src 'self' http://127.0.0.1:43210; form-action 'none'"
  );
  expect(() => composeLocalCsp(policy, 'https://production.test')).toThrow(
    'LOCAL_PROFILE_ONLY'
  );
  expect(isLocalFixtureFetch('https://api.openai.com/v1/responses')).toBe(
    false
  );
  expect(isLocalFixtureFetch('https://production.test')).toBe(false);
  expect(isLocalFixtureFetch('http://127.0.0.1:43210/rest/v1/products')).toBe(
    true
  );
});

it('delegates headers once to the original receiver without recursive reentry', () => {
  const original = vi.fn(function (this: object) {
    return this;
  });
  const receiver = {};
  const setter = localHeaderSetter(original, 'http://127.0.0.1:43210');
  expect(setter.call(receiver, 'Content-Type', 'text/html')).toBe(receiver);
  expect(original).toHaveBeenCalledExactlyOnceWith('Content-Type', 'text/html');
  setter.call(receiver, 'Content-Security-Policy', "default-src 'none'");
  expect(original).toHaveBeenLastCalledWith(
    'Content-Security-Policy',
    expect.stringContaining('frame-src')
  );
});
