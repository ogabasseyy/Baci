import type { ReactNode } from 'react';

export const consentScriptMocks = { onReady: new Map<string, () => void>() };

export function ConsentScriptStub({
  id,
  children,
  src,
  onReady,
}: {
  id: string;
  children?: ReactNode;
  src?: string;
  onReady?: () => void;
}) {
  if (onReady) consentScriptMocks.onReady.set(id, onReady);
  return (
    <pre hidden data-testid={id} data-src={src}>
      {children}
    </pre>
  );
}
