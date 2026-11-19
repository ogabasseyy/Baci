import { isImeComposing } from '@/lib/is-ime-composing';

interface EnterKeyEvent {
  key: string;
  preventDefault: () => void;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; key?: string; keyCode?: number };
}

/**
 * Runs `action` for an Enter keydown and reports whether it ran.
 *
 * Enter is always cancelled so a surrounding form cannot submit implicitly.
 * The action is skipped while an IME is composing, where Enter only confirms
 * a character candidate.
 */
export function runOnEnter(event: EnterKeyEvent, action: () => void): boolean {
  if (event.key !== 'Enter') return false;
  event.preventDefault();
  if (isImeComposing(event)) return false;
  action();
  return true;
}
