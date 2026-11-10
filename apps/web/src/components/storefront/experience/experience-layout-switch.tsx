'use client';
import type { ExperienceManifest } from '@baci/shared/experience';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  isCategorizedExperienceProductPath,
  resolveExperienceRoute,
} from '@/lib/experience/route-ownership';
/** Layout selection is presentation only; the server boundary still resolves product identity. */
export function ExperienceLayoutSwitch({
  routes,
  basePath,
  nativeLayout,
  children,
}: {
  routes: ExperienceManifest['routes'];
  basePath: string;
  nativeLayout: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const path =
    pathname === basePath
      ? '/'
      : pathname.startsWith(`${basePath}/`)
        ? pathname.slice(basePath.length)
        : null;
  const owned =
    path &&
    (resolveExperienceRoute(routes, path) ||
      (routes.some((route) => route.view === 'product') &&
        isCategorizedExperienceProductPath(path)));
  return owned ? children : nativeLayout;
}
