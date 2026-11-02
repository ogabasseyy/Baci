import { type RefObject, useEffect, useRef } from 'react';

function runAll(tasksRef: RefObject<Array<() => void>>) {
  const tasks = tasksRef.current;
  tasksRef.current = [];
  for (const task of tasks) task();
}

/**
 * Holds tasks until a sheet reports that its native modal has gone. iOS
 * cannot present another modal (a dialog or alert) while one is still on
 * screen, so anything shown right after closing a sheet must wait.
 */
export function useDeferredUntilDismissed() {
  const tasksRef = useRef<Array<() => void>>([]);

  // If the screen goes away mid-close, React Native delivers no onDismiss
  // for its modal. Run what is still waiting so a booking alert (such as an
  // unconfirmed booking) still reaches the merchant; state updates from the
  // unmounted screen are harmless no-ops.
  useEffect(() => () => runAll(tasksRef), []);

  const defer = (task: () => void) => {
    tasksRef.current.push(task);
  };

  const flush = () => runAll(tasksRef);

  return { defer, flush };
}
