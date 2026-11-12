// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { getRuntimePlatform } from '@/config/runtime-platform';
import { getVirtualizedListProps } from './virtualized-list-props';

describe('getVirtualizedListProps', () => {
  it('returns Android clipping and windowing defaults', () => {
    expect(getVirtualizedListProps('android')).toEqual({
      initialNumToRender: 15,
      maxToRenderPerBatch: 10,
      removeClippedSubviews: true,
      windowSize: 5,
    });
  });

  it('returns iOS-safe defaults without clipped subviews', () => {
    expect(getVirtualizedListProps('ios')).toEqual({
      initialNumToRender: 15,
      maxToRenderPerBatch: 10,
      removeClippedSubviews: false,
      windowSize: 5,
    });
  });

  it('uses Platform.OS when no platform argument is provided', () => {
    expect(getVirtualizedListProps()).toEqual(
      getVirtualizedListProps(getRuntimePlatform())
    );
  });
});
