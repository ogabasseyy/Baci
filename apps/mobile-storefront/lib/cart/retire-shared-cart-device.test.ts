import { NativeCartError } from './native-cart-error';
import { retireSharedCartDevice } from './retire-shared-cart-device';

const receipts = () => ({
  read: jest.fn().mockResolvedValue({ operationId: 'op' }),
  save: jest.fn(),
  clear: jest.fn().mockResolvedValue(undefined),
});

it('does nothing without a device to retire', async () => {
  const r = receipts();
  await retireSharedCartDevice(undefined, r, 'm');
  expect(r.read).not.toHaveBeenCalled();
});

it('revokes the device and clears any saved request', async () => {
  const r = receipts();
  const retire = jest.fn().mockResolvedValue(undefined);
  await retireSharedCartDevice(retire, r, 'm');
  expect(retire).toHaveBeenCalledTimes(1);
  expect(r.clear).toHaveBeenCalledWith('m', 'op');
});

it('clears the saved request and rethrows when revocation is pending', async () => {
  const r = receipts();
  const error = new NativeCartError('revocation_pending');
  await expect(
    retireSharedCartDevice(jest.fn().mockRejectedValue(error), r, 'm')
  ).rejects.toBe(error);
  expect(r.clear).toHaveBeenCalledWith('m', 'op');
});

it('rethrows other failures without touching receipts', async () => {
  const r = receipts();
  await expect(
    retireSharedCartDevice(jest.fn().mockRejectedValue(new Error('x')), r, 'm')
  ).rejects.toThrow('x');
  expect(r.clear).not.toHaveBeenCalled();
});
