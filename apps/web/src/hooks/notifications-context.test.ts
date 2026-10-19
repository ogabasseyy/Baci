import { renderHook } from '@testing-library/react';
import { useContext } from 'react';
import { describe, expect, it } from 'vitest';
import NotificationsContext from './notifications-context';

describe('NotificationsContext', () => {
  it('starts without a notification value before a provider is mounted', () => {
    const { result } = renderHook(() => useContext(NotificationsContext));

    expect(result.current).toBeNull();
  });
});
