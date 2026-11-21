import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { useOxygenApplicationDraft } from './use-oxygen-application-draft';

describe('local Oxygen step navigation', () => {
  beforeEach(() => {
    jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() });
  });
  it('changes steps immediately while a blur save is pending, then persists the new step in order', async () => {
    let finish: (value: { version: number }) => void = () => {};
    const write = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue({ version: 2 });
    const client = {
      draft: {
        read: jest.fn().mockResolvedValue({ version: 0, draft: null }),
        write,
      },
    } as unknown as OxygenClient;
    const { result } = renderHook(() =>
      useOxygenApplicationDraft(
        client,
        '11111111-1111-4111-8111-111111111111',
        'owner/order',
        true
      )
    );
    await act(async () => {});
    act(() => result.current.setFields({ first_name: 'Test' }));
    act(() => {
      void result.current.flush();
    });
    let navigation: Promise<boolean> = Promise.resolve(false);
    act(() => {
      navigation = result.current.save(1);
    });
    expect(result.current.step).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ version: 1 });
      expect(await navigation).toBe(true);
    });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        version: 1,
        draft: { step: 1, fields: { first_name: 'Test' } },
      })
    );
    expect(result.current.step).toBe(1);
  });

  it('keeps local navigation usable after a save failure and requires a successful retry', async () => {
    let fail: (error: Error) => void = () => {};
    const write = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          })
      )
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 });
    const client = {
      draft: {
        read: jest.fn().mockResolvedValue({ version: 0, draft: null }),
        write,
      },
    } as unknown as OxygenClient;
    const { result } = renderHook(() =>
      useOxygenApplicationDraft(
        client,
        '11111111-1111-4111-8111-111111111111',
        'owner/order',
        true
      )
    );
    await act(async () => {});
    let navigation: Promise<boolean> = Promise.resolve(false);
    act(() => {
      navigation = result.current.save(1);
    });
    expect(result.current.step).toBe(1);
    await act(async () => {
      fail(new Error('network unavailable'));
      expect(await navigation).toBe(false);
    });
    expect(result.current.step).toBe(1);
    expect(result.current.error).toMatch(/Could not save/);
    await act(async () => {
      expect(await result.current.save(2)).toBe(true);
    });
    expect(result.current.error).toBeNull();
    expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0]);
    expect(write.mock.calls[2][0]).toEqual(
      expect.objectContaining({ version: 1, draft: { step: 2, fields: {} } })
    );
    expect(write.mock.calls[2][0].idempotencyKey).not.toBe(
      write.mock.calls[0][0].idempotencyKey
    );
  });
});
