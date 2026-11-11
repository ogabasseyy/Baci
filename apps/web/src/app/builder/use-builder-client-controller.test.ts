// @vitest-environment jsdom

import './builder-client.test-support';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupBuilderClientTest,
  resetBuilderClientTest,
} from './builder-client.test-support';
import { useBuilderClientController } from './use-builder-client-controller';

describe('useBuilderClientController', () => {
  beforeEach(resetBuilderClientTest);
  afterEach(cleanupBuilderClientTest);

  it('loads the current merchant and exposes recovery mode', async () => {
    const { result } = renderHook(() => useBuilderClientController());

    await waitFor(() => expect(result.current.pageLoading).toBe(false));
    expect(result.current.merchant?.id).toBe('merchant-1');
    expect(result.current.shouldBlockBuilder).toBe(true);
  });

  it('keeps loaded content unchanged when the builder is read-only', async () => {
    const { result } = renderHook(() => useBuilderClientController());

    await waitFor(() => expect(result.current.pageLoading).toBe(false));

    act(() => {
      result.current.handleDataChange({
        content: [{ type: 'Text', props: { text: 'Blocked edit' } }],
        root: { title: 'Changed' },
        zones: {},
      });
    });

    expect(result.current.data).toEqual({
      content: [],
      root: { title: 'Home' },
      zones: {},
    });
  });
});
