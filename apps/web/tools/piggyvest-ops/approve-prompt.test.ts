import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  createHiddenPrompt,
  createLinePrompt,
  type PromptInput,
} from './approve-prompt';

class FakeTty extends EventEmitter implements PromptInput {
  isTTY = true;
  isRaw = false;
  setRawMode = vi.fn((mode: boolean) => {
    this.isRaw = mode;
    return this;
  });
  resume = vi.fn(() => this);
  pause = vi.fn(() => this);
  type(text: string) {
    this.emit('data', Buffer.from(text, 'utf8'));
  }
}

function output() {
  const written: string[] = [];
  return { written, stream: { write: (text: string) => written.push(text) } };
}

describe('createHiddenPrompt', () => {
  it('reads the password without echoing it and restores the terminal', async () => {
    const input = new FakeTty();
    const out = output();
    const answer = createHiddenPrompt(input, out.stream)('Password: ');
    input.type('hun');
    input.type('ter2\r');
    await expect(answer).resolves.toBe('hunter2');
    expect(out.written.join('')).toBe('Password: \n');
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.pause).toHaveBeenCalled();
    expect(input.listenerCount('data')).toBe(0);
  });

  it('handles backspace and a pasted line', async () => {
    const input = new FakeTty();
    const answer = createHiddenPrompt(input, output().stream)('Password: ');
    input.type('abx\u007fc\n');
    await expect(answer).resolves.toBe('abc');
  });

  it('cancels on Ctrl-C without returning what was typed', async () => {
    const input = new FakeTty();
    const answer = createHiddenPrompt(input, output().stream)('Password: ');
    input.type('secr\u0003');
    await expect(answer).rejects.toThrow('Cancelled');
    expect(input.isRaw).toBe(false);
  });

  it('refuses when the input is not a terminal', async () => {
    const input = new FakeTty();
    input.isTTY = false;
    await expect(
      createHiddenPrompt(input, output().stream)('Password: ')
    ).rejects.toThrow('A hidden prompt needs an interactive terminal');
    expect(input.setRawMode).not.toHaveBeenCalled();
  });
});

describe('createLinePrompt', () => {
  it('returns one typed line', async () => {
    const input = new PassThrough();
    const out = new PassThrough();
    const answer = createLinePrompt(input, out)('Amount: ');
    input.write('15,000.00\n');
    await expect(answer).resolves.toBe('15,000.00');
  });
});
