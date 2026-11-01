import { useRef } from 'react';

/**
 * Holds tasks until a sheet reports that its native modal has gone. iOS
 * cannot present another modal (a dialog or alert) while one is still on
 * screen, so anything shown right after closing a sheet must wait.
 */
export function useDeferredUntilDismissed() {
  const tasksRef = useRef<Array<() => void>>([]);

  const defer = (task: () => void) => {
    tasksRef.current.push(task);
  };

  const flush = () => {
    const tasks = tasksRef.current;
    tasksRef.current = [];
    for (const task of tasks) task();
  };

  return { defer, flush };
}
