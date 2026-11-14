import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface ComparePageBreadcrumbItem {
  name: string;
  url: string;
}

interface ComparePageBreadcrumbProps {
  breadcrumbItems?: ComparePageBreadcrumbItem[];
  fallbackTerminalName: string;
}

export function ComparePageBreadcrumb({
  breadcrumbItems,
  fallbackTerminalName,
}: ComparePageBreadcrumbProps) {
  if (!breadcrumbItems || breadcrumbItems.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-6 text-sm text-store-background-text/65"
    >
      <ol className="flex flex-wrap items-center gap-2">
        {breadcrumbItems.map((item, index) => {
          const isTerminal = index === breadcrumbItems.length - 1;
          return (
            <li key={item.url} className="flex items-center gap-2">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="text-store-background-text/40"
                >
                  /
                </span>
              )}
              {isTerminal ? (
                <span
                  aria-current="page"
                  className="font-medium text-store-background-text"
                >
                  {item.name || fallbackTerminalName}
                </span>
              ) : (
                <Link
                  href={asRoute(item.url)}
                  className="transition-colors hover:text-store-primary"
                >
                  {item.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
