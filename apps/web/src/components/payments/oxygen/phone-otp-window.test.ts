import { expect, it, vi } from 'vitest';
import { readPhoneOtpSend, rememberPhoneOtpSend } from './phone-otp-window';

it('persists only a confirmed request timestamp and preserves it on reopening', () => {
  const time = Date.now() - 60000;
  rememberPhoneOtpSend('test-phone-window', time);
  expect(readPhoneOtpSend('test-phone-window')).toBe(time);
  expect(
    sessionStorage.getItem('oxygen:phone-otp-sent:test-phone-window')
  ).toBe(String(time));
  expect(readPhoneOtpSend('other-workflow')).toBeUndefined();
});
it('rejects invalid or future timestamps without inventing a fresh window', () => {
  sessionStorage.setItem('oxygen:phone-otp-sent:invalid', 'not-a-time');
  expect(readPhoneOtpSend('invalid')).toBeUndefined();
  sessionStorage.setItem(
    'oxygen:phone-otp-sent:future',
    String(Date.now() + 600000)
  );
  expect(readPhoneOtpSend('future')).toBeUndefined();
});
it('keeps the original send time when session storage is unavailable', () => {
  const time = Date.now() - 1000;
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('blocked');
    });
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  rememberPhoneOtpSend('memory-only', time);
  expect(readPhoneOtpSend('memory-only')).toBe(time);
  write.mockRestore();
  read.mockRestore();
});
