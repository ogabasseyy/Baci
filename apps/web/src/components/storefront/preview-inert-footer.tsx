type PreviewLink = {
  label: string;
  url?: string;
};

type PreviewInertFooterProps = {
  backgroundColor?: string;
  brandName?: string;
  copyrightText?: string;
  quickLinks?: PreviewLink[];
  quickLinksLabel?: string;
  showNewsletter?: boolean;
  showQuickLinks?: boolean;
  socialLinks?: Record<string, string>;
  socialLinksLabel?: string;
  textColor?: string;
};

function InertFooterAction({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <button aria-disabled="true" className={className} disabled type="button">
      {children}
    </button>
  );
}

export function PreviewInertFooter({
  backgroundColor,
  brandName = 'Preview Store',
  copyrightText = '© Store. All rights reserved.',
  quickLinks = [],
  quickLinksLabel = 'Quick links',
  showNewsletter = false,
  showQuickLinks = true,
  socialLinks = {},
  socialLinksLabel = 'Follow us',
  textColor,
}: PreviewInertFooterProps) {
  const socialPlatforms = Object.entries(socialLinks).flatMap(
    ([platform, url]) => (url ? [platform] : [])
  );

  return (
    <footer
      className="mt-auto py-12"
      data-testid="builder-preview-inert-footer"
      style={{
        backgroundColor: backgroundColor || 'var(--theme-footer-bg, #1A202C)',
        color: textColor || 'var(--theme-footer-text, #FFFFFF)',
      }}
    >
      <div className="container mx-auto px-4">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="text-lg font-semibold mb-4">{brandName}</h3>
            <p className="text-sm">{copyrightText}</p>
          </div>

          {showQuickLinks && quickLinks.length > 0 ? (
            <div>
              <h3 className="text-lg font-semibold mb-4">{quickLinksLabel}</h3>
              <nav aria-label="Preview footer navigation">
                <ul className="flex flex-col gap-2 list-none p-0 m-0">
                  {quickLinks.map((link) => (
                    <li key={link.url || link.label}>
                      <InertFooterAction className="text-sm hover:underline underline-offset-4">
                        {link.label}
                      </InertFooterAction>
                      {link.url ? (
                        <output
                          aria-label={`Preview footer link ${link.label} destination`}
                          className="block max-w-full truncate text-xs opacity-80"
                          title={link.url}
                        >
                          {link.url}
                        </output>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          ) : null}

          {socialPlatforms.length > 0 ? (
            <div>
              <h3 className="text-lg font-semibold mb-4">{socialLinksLabel}</h3>
              <div className="flex gap-4">
                {socialPlatforms.map((platform) => (
                  <InertFooterAction
                    className="transition-opacity hover:opacity-100"
                    key={platform}
                  >
                    {platform}
                  </InertFooterAction>
                ))}
              </div>
            </div>
          ) : null}

          {showNewsletter ? (
            <div>
              <h3 className="text-lg font-semibold mb-4">Newsletter</h3>
              <div className="flex gap-2">
                <input
                  aria-label="Email address for newsletter"
                  className="flex-1"
                  disabled
                  placeholder="Your email"
                  type="email"
                />
                <InertFooterAction>Subscribe</InertFooterAction>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
