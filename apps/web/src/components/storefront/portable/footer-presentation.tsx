import type { ReactNode } from 'react';

/** Production footer shell; effects and destinations belong to its adapter. */
export function FooterPresentation({
  brandName,
  copyrightText,
  children,
  backgroundColor,
  textColor,
}: {
  brandName: string;
  copyrightText: string;
  children: ReactNode;
  backgroundColor?: string;
  textColor?: string;
}) {
  return (
    <footer
      className="mt-auto py-12"
      style={{
        backgroundColor: backgroundColor || 'var(--theme-footer-bg, #1A202C)',
        color: textColor || 'var(--theme-footer-text, #FFFFFF)',
      }}
    >
      <div className="container mx-auto px-4 baci-container">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 baci-footer">
          <div>
            <h3 className="text-lg font-semibold mb-4">{brandName}</h3>
            <p className="text-sm">{copyrightText}</p>
          </div>
          {children}
        </div>
      </div>
    </footer>
  );
}
