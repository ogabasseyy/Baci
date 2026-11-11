import type { ExperienceFrameLaunch } from './experience-frame-types';

interface ExperiencePreviewNavigationProps {
  canonicalBase: string;
  routes: ExperienceFrameLaunch['routes'];
  onNavigate: (href: string) => void;
}

export function ExperiencePreviewNavigation({
  canonicalBase,
  routes,
  onNavigate,
}: ExperiencePreviewNavigationProps) {
  return (
    <nav aria-label="Preview routes">
      {routes.map((route) => (
        <button
          type="button"
          key={route.path}
          onClick={() =>
            onNavigate(
              canonicalBase.replace(/\/$/, '') +
                route.path.replace(
                  /\[[^\]]+\]/g,
                  route.view === 'collection'
                    ? 'devices'
                    : route.view === 'product'
                      ? 'device'
                      : 'design'
                )
            )
          }
        >
          {route.view}
        </button>
      ))}
    </nav>
  );
}
