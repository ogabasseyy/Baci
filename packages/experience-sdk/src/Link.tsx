import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useCommerce } from './provider';
export interface ExperienceLinkProps
  extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'href' | 'target' | 'onClick'
  > {
  path: string;
  newContext?: boolean;
}
/** Frame never receives popup permission; the host presents the canonical anchor. */
export function Link({
  path,
  newContext,
  children,
  ...rest
}: ExperienceLinkProps) {
  const commerce = useCommerce();
  const activate = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    e.preventDefault();
    void (newContext || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1
      ? commerce.navigation.open(path)
      : commerce.navigation.go(path));
  };
  return (
    <a {...rest} href={path} onClick={activate} onAuxClick={activate}>
      {children}
    </a>
  );
}
