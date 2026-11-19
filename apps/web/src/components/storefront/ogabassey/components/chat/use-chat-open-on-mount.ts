import { useEffect, useRef } from 'react';

/** Apply the deferred launch request once, without reopening after a close. */
export function useChatOpenOnMount(
  openOnMount: boolean,
  setIsOpen: (open: boolean) => void
) {
  const opened = useRef(false);
  useEffect(() => {
    if (openOnMount && !opened.current) {
      opened.current = true;
      setIsOpen(true);
    }
  }, [openOnMount, setIsOpen]);
}
