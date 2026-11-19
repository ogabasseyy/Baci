// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadRecord,
  pruneRecords,
  removeRecord,
  type StashRecord,
  saveRecord,
} from './private-url-param-records';

const KEY = (id: string) => `baci:private-url-params:${id}`;

function record(savedAt: number, token = 'abc'): StashRecord {
  return {
    pathname: '/track-order',
    publicSearch: '',
    entries: [['token', token]],
    savedAt,
  };
}

function blockStorage() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
}

describe('private-url-param-records', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a record through sessionStorage', () => {
    saveRecord('a', record(1));

    expect(window.sessionStorage.getItem(KEY('a'))).not.toBeNull();
    expect(loadRecord('a')).toEqual(record(1));
  });

  it('returns undefined for an unknown id', () => {
    expect(loadRecord('missing')).toBeUndefined();
  });

  it('falls back to page memory when storage throws on write and read', () => {
    blockStorage();

    saveRecord('mem', record(1, 'secret'));

    expect(loadRecord('mem')).toEqual(record(1, 'secret'));
  });

  it('falls back to memory when the stored JSON is unreadable', () => {
    window.sessionStorage.setItem(KEY('bad'), '{not json');

    expect(loadRecord('bad')).toBeUndefined();
  });

  it('removes a record from storage and memory', () => {
    saveRecord('a', record(1));
    removeRecord('a');

    expect(loadRecord('a')).toBeUndefined();
    expect(window.sessionStorage.getItem(KEY('a'))).toBeNull();
  });

  it('removes a memory-only record even when storage throws on remove', () => {
    blockStorage();
    saveRecord('mem', record(1));
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => removeRecord('mem')).not.toThrow();
    expect(loadRecord('mem')).toBeUndefined();
  });

  it('keeps the newest 30 stored records and drops the oldest first', () => {
    for (let i = 0; i < 33; i++) saveRecord(`r${i}`, record(i));

    pruneRecords();

    expect(window.sessionStorage.length).toBe(30);
    expect(window.sessionStorage.getItem(KEY('r0'))).toBeNull();
    expect(window.sessionStorage.getItem(KEY('r2'))).toBeNull();
    expect(window.sessionStorage.getItem(KEY('r3'))).not.toBeNull();
    expect(window.sessionStorage.getItem(KEY('r32'))).not.toBeNull();
  });

  it('removes unreadable records first and leaves other keys alone', () => {
    window.sessionStorage.setItem('unrelated', 'keep');
    window.sessionStorage.setItem(KEY('garbage'), '{nope');
    for (let i = 0; i < 30; i++) saveRecord(`r${i}`, record(i + 1));

    pruneRecords();

    expect(window.sessionStorage.getItem(KEY('garbage'))).toBeNull();
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep');
    expect(window.sessionStorage.getItem(KEY('r0'))).not.toBeNull();
  });

  it('caps the in-memory fallback at 30 records, oldest first', () => {
    blockStorage();
    for (let i = 0; i < 32; i++) saveRecord(`m${i}`, record(i));

    pruneRecords();

    expect(loadRecord('m0')).toBeUndefined();
    expect(loadRecord('m1')).toBeUndefined();
    expect(loadRecord('m2')).toEqual(record(2));
    expect(loadRecord('m31')).toEqual(record(31));
  });

  it('does not throw when storage is blocked while pruning', () => {
    blockStorage();
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => pruneRecords()).not.toThrow();
  });
});
