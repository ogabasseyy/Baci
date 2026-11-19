import { act, renderHook } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { useOxygenBanks } from './use-oxygen-banks';

it('retries a failed bank catalog read without reopening checkout', async () => {
  const banks = [{ code: '044', name: 'Access Bank' }];
  const bankDetails = jest
    .fn()
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValue({ banks });
  const client = { bankDetails } as unknown as OxygenClient;
  const { result } = renderHook(() => useOxygenBanks(client, 'workflow', true));
  await act(async () => {});
  expect(result.current.error).toMatch(/Could not load banks/);
  await act(async () => result.current.retry());
  expect(bankDetails).toHaveBeenCalledTimes(2);
  expect(result.current.error).toBeNull();
  expect(result.current.banks).toEqual(banks);
});
