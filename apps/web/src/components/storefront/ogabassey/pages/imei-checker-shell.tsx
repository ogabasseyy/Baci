import type { ReactNode } from 'react';

interface OgabasseyImeiCheckerShellProps {
  children: ReactNode;
  omitShell?: boolean;
}

export function OgabasseyImeiCheckerShell({
  children,
  omitShell = false,
}: OgabasseyImeiCheckerShellProps) {
  if (omitShell) {
    return children;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--store-background,#ffffff)] text-[var(--store-background-text,#111827)] pb-24 pt-4 md:pb-12 md:pt-8">
      <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 md:px-6">
        {children}
      </div>
    </div>
  );
}
