import { describe, expect, it, vi } from 'vitest';
import { runOnEnter } from './run-on-enter';

function keyEvent(init: {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}) {
  return { ...init, preventDefault: vi.fn() };
}

describe('runOnEnter', () => {
  it('cancels Enter and runs the action', () => {
    const event = keyEvent({ key: 'Enter', keyCode: 13 });
    const action = vi.fn();

    expect(runOnEnter(event, action)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });

  it('ignores other keys without cancelling them', () => {
    const event = keyEvent({ key: 'a' });
    const action = vi.fn();

    expect(runOnEnter(event, action)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('cancels a composing Enter but skips the action', () => {
    const composing = keyEvent({ key: 'Enter', isComposing: true });
    const safari = keyEvent({ key: 'Enter', keyCode: 229 });
    const action = vi.fn();

    expect(runOnEnter(composing, action)).toBe(false);
    expect(runOnEnter(safari, action)).toBe(false);
    expect(composing.preventDefault).toHaveBeenCalledOnce();
    expect(safari.preventDefault).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
  });
});
