// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCachedImageUri } from './useCachedImageUri';

const { expoConfigState } = vi.hoisted(() => ({
  expoConfigState: {
    extra: {} as { supabaseUrl?: string },
  },
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      get extra() {
        return expoConfigState.extra;
      },
    },
  },
}));

describe('useCachedImageUri', () => {
  beforeEach(() => {
    expoConfigState.extra = {};
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null if remoteUri is falsy', () => {
    const { result } = renderHook(() => useCachedImageUri(null));
    expect(result.current.uri).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('returns the same remoteUri immediately for local or data URIs', () => {
    const localPath = 'file:///local/path.png';
    const { result } = renderHook(() => useCachedImageUri(localPath));
    expect(result.current.uri).toBe(localPath);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns a target-sized Supabase URL immediately without manually downloading it', () => {
    const remoteUri =
      'https://project.supabase.co/storage/v1/object/public/media/merchant/logo.png';

    const { result } = renderHook(() =>
      useCachedImageUri(remoteUri, {
        width: 192,
        height: 192,
        resize: 'contain',
      })
    );

    expect(result.current).toEqual({
      fallbackUri: remoteUri,
      uri: 'https://project.supabase.co/storage/v1/render/image/public/media/merchant/logo.png?width=192&height=192&resize=contain',
      isLoading: false,
    });
  });

  it('uses the Expo config Supabase URL when the environment URL is empty', () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', '');
    expoConfigState.extra = {
      supabaseUrl: 'https://expo-project.supabase.co',
    };
    const remoteUri =
      'https://expo-project.supabase.co/storage/v1/object/public/media/merchant/logo.png';

    const { result } = renderHook(() =>
      useCachedImageUri(remoteUri, {
        width: 192,
        height: 192,
        resize: 'cover',
      })
    );

    expect(result.current).toEqual({
      fallbackUri: remoteUri,
      uri: 'https://expo-project.supabase.co/storage/v1/render/image/public/media/merchant/logo.png?width=192&height=192&resize=cover',
      isLoading: false,
    });
  });

  it('delegates non-Supabase remote image caching to the native image pipeline', () => {
    const remoteUri = 'https://cdn.example.com/avatar.png';

    const { result } = renderHook(() =>
      useCachedImageUri(remoteUri, {
        width: 192,
        height: 192,
        resize: 'cover',
      })
    );

    expect(result.current).toEqual({
      fallbackUri: null,
      uri: remoteUri,
      isLoading: false,
    });
  });

  it('does not rewrite a Supabase-looking path hosted by a third-party CDN', () => {
    const remoteUri =
      'https://cdn.example.com/storage/v1/object/public/media/merchant/logo.png';

    const { result } = renderHook(() =>
      useCachedImageUri(remoteUri, {
        width: 192,
        height: 192,
        resize: 'cover',
      })
    );

    expect(result.current).toEqual({
      fallbackUri: null,
      uri: remoteUri,
      isLoading: false,
    });
  });

  it('does not send SVG assets through the bitmap transformation endpoint', () => {
    const remoteUri =
      'https://project.supabase.co/storage/v1/object/public/media/merchant/logo.svg';

    const { result } = renderHook(() =>
      useCachedImageUri(remoteUri, {
        width: 256,
        height: 256,
        resize: 'contain',
      })
    );

    expect(result.current).toEqual({
      fallbackUri: null,
      uri: remoteUri,
      isLoading: false,
    });
  });
});
