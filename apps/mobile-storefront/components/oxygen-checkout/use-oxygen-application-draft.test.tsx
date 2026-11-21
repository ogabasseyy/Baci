import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { useOxygenApplicationDraft } from './use-oxygen-application-draft';

describe('encrypted native Oxygen draft lifecycle', () => {
  beforeEach(() => {
    jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() });
  });
  it('does not persist typing pauses; saves the latest fields when the app backgrounds', async () => {
    jest.useFakeTimers();
    let stateChanged: (state: AppStateStatus) => void = () => {};
    const listener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, handler) => {
        stateChanged = handler;
        return { remove: jest.fn() };
      });
    const write = jest.fn().mockResolvedValue({ version: 1 });
    const client = {
      draft: {
        read: jest.fn().mockResolvedValue({ version: 0, draft: null }),
        write,
      },
    } as unknown as OxygenClient;
    try {
      const { result } = renderHook(() =>
        useOxygenApplicationDraft(
          client,
          '11111111-1111-4111-8111-111111111111',
          'owner/order',
          true
        )
      );
      await act(async () => {});
      act(() => result.current.setFields({ bvn: '123' }));
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(write).not.toHaveBeenCalled();
      await act(async () => {
        stateChanged('background');
      });
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({ draft: { step: 0, fields: { bvn: '123' } } })
      );
    } finally {
      listener.mockRestore();
      jest.useRealTimers();
    }
  });

  it('serializes blur saves without including later unblurred typing', async () => {
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
    act(() => result.current.setFields({ bvn: '1' }));
    act(() => {
      void result.current.flush();
    });
    act(() => result.current.setFields({ bvn: '12' }));
    act(() => {
      void result.current.flush();
    });
    act(() => result.current.setFields({ bvn: '123' }));
    await act(async () => {
      finish({ version: 1 });
    });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].draft.fields.bvn).toBe('12');
    expect(result.current.fields.bvn).toBe('123');
  });
  it('flushes unblurred changes on unmount after an in-flight save', async () => {
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
    const { result, unmount } = renderHook(() =>
      useOxygenApplicationDraft(
        client,
        '11111111-1111-4111-8111-111111111111',
        'owner/order',
        true
      )
    );
    await act(async () => {});
    act(() => result.current.setFields({ first_name: 'First' }));
    act(() => {
      void result.current.flush();
    });
    act(() => result.current.setFields({ first_name: 'Last' }));
    unmount();
    await act(async () => finish({ version: 1 }));
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        version: 1,
        draft: { step: 0, fields: { first_name: 'Last' } },
      })
    );
  });

  it.each([
    null,
    { step: 0, fields: { first_name: '', email: 'edited@example.invalid' } },
  ])('seeds checkout identity only without an existing draft: %j', async (draft) => {
    const prefill = {
      first_name: 'Checkout',
      last_name: 'Customer',
      email: 'checkout@example.invalid',
    };
    const client = {
      draft: {
        read: jest.fn().mockResolvedValue({ version: draft ? 2 : 0, draft }),
        write: jest.fn(),
      },
    } as unknown as OxygenClient;
    const { result } = renderHook(() =>
      useOxygenApplicationDraft(
        client,
        '11111111-1111-4111-8111-111111111111',
        'owner/order',
        true,
        prefill
      )
    );
    await act(async () => {});
    expect(result.current.loaded).toBe(true);
    expect(result.current.fields).toEqual(draft ? draft.fields : prefill);
  });
  it('ignores an old save and releases busy state after scope changes', async () => {
    let finish: (result: { version: number; draft: null }) => void = () => {};
    const write = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue({ version: 2, draft: null });
    const client = {
      draft: {
        read: jest.fn().mockResolvedValue({ version: 0, draft: null }),
        write,
      },
    } as unknown as OxygenClient;
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useOxygenApplicationDraft(
          client,
          '11111111-1111-4111-8111-111111111111',
          scope,
          true
        ),
      { initialProps: { scope: 'one' } }
    );
    await act(async () => {});
    let save: Promise<boolean>;
    act(() => {
      save = result.current.save(1);
    });
    rerender({ scope: 'two' });
    await act(async () => {});
    expect(result.current.saving).toBe(false);
    await act(async () => {
      finish({ version: 1, draft: null });
      await save;
    });
    expect(result.current.step).toBe(0);
    await act(async () => {
      await result.current.save(1);
    });
    expect(result.current.step).toBe(1);
  });
});

it.each([
  { first_name: 'Saved' },
  { first_name: 'Saved', home_street: '' },
  { first_name: 'Saved', home_street: 'Edited road' },
])('restores checkout home only when the draft never contained a home address: %j', async (saved) => {
  const prefill = {
    first_name: 'Checkout',
    home_street: '2 Example Road',
    home_state: 'Lagos',
    home_city: 'Ikeja',
  };
  const client = {
    draft: {
      read: jest
        .fn()
        .mockResolvedValue({ version: 3, draft: { step: 2, fields: saved } }),
      write: jest.fn(),
    },
  } as unknown as OxygenClient;
  const { result } = renderHook(() =>
    useOxygenApplicationDraft(
      client,
      '11111111-1111-4111-8111-111111111111',
      'owner/order',
      true,
      prefill
    )
  );
  await act(async () => {});
  expect(result.current.fields.first_name).toBe('Saved');
  expect(result.current.step).toBe(2);
  if ('home_street' in saved) expect(result.current.fields).toEqual(saved);
  else
    expect(result.current.fields).toEqual({
      ...saved,
      home_street: prefill.home_street,
      home_state: prefill.home_state,
      home_city: prefill.home_city,
    });
});
