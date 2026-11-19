import { describe, expect, it } from 'vitest';
import { pageWindow } from './mock-paging';

describe('pageWindow: advance', () => {
  it('walks the rows page by page and ends without a next cursor', () => {
    expect(pageWindow('advance', null, 2, 5)).toEqual({
      start: 0,
      end: 2,
      hasNextPage: true,
      endCursor: '2',
      previousCursor: null,
    });
    expect(pageWindow('advance', '2', 2, 5)).toMatchObject({
      start: 2,
      end: 4,
      endCursor: '4',
      previousCursor: '0',
    });
    expect(pageWindow('advance', '4', 2, 5)).toMatchObject({
      start: 4,
      end: 5,
      hasNextPage: false,
      endCursor: null,
    });
  });

  it('has a single empty page for no rows', () => {
    expect(pageWindow('advance', null, 3, 0)).toMatchObject({
      start: 0,
      end: 0,
      hasNextPage: false,
      endCursor: null,
    });
  });
});

describe('pageWindow: pagers that look like they move but do not', () => {
  it('rotating_cursor_same_rows repeats the first rows under a new cursor every time', () => {
    const first = pageWindow('rotating_cursor_same_rows', null, 2, 7);
    const second = pageWindow(
      'rotating_cursor_same_rows',
      first.endCursor,
      2,
      7
    );
    const third = pageWindow(
      'rotating_cursor_same_rows',
      second.endCursor,
      2,
      7
    );
    expect([first.start, second.start, third.start]).toEqual([0, 0, 0]);
    expect([first.endCursor, second.endCursor, third.endCursor]).toEqual([
      '2',
      '4',
      '6',
    ]);
  });

  it('stuck_cursor keeps handing back the same next cursor', () => {
    const first = pageWindow('stuck_cursor', null, 2, 7);
    const second = pageWindow('stuck_cursor', first.endCursor, 2, 7);
    expect(first.endCursor).toBe('2');
    expect(second.endCursor).toBe('2');
    expect(second.start).toBe(2);
  });
});
