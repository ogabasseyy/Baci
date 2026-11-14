interface ComposingKeyEvent {
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; key?: string; keyCode?: number };
}

/** `keyCode` browsers report on keydown while an IME is consuming the key. */
const IME_PROCESS_KEY_CODE = 229;
/** `key` some browsers report for the same IME-consumed keydown. */
const IME_PROCESS_KEY = 'Process';

/**
 * True when a keydown belongs to an in-progress IME composition (Chinese,
 * Japanese, Korean keyboards), where Enter confirms a character candidate and
 * must not submit or commit anything.
 *
 * Accepts a DOM or React keyboard event. The `keyCode === 229` and
 * `key === 'Process'` checks cover Safari, which can report
 * `isComposing: false` on the confirming Enter.
 *
 * Inside a form, callers should still `preventDefault()` the composing Enter so
 * the browser cannot submit the form implicitly.
 */
export function isImeComposing(event: ComposingKeyEvent): boolean {
  const native = event.nativeEvent ?? event;
  return (
    native.isComposing === true ||
    native.keyCode === IME_PROCESS_KEY_CODE ||
    event.keyCode === IME_PROCESS_KEY_CODE ||
    native.key === IME_PROCESS_KEY ||
    event.key === IME_PROCESS_KEY
  );
}
