import { resolveExperienceRoute } from '@/lib/experience/route-ownership';
import type {
  ExperienceFrameLaunch,
  PublishedExperienceFrameHost,
} from './experience-frame-types';
import {
  canonicalExperiencePath,
  type createNavigationPresentation,
  type PresentedCanonicalLink,
} from './experience-navigation-open';
import { createPreviewDispatcher } from './experience-preview-dispatch';
import type { createRouteCoordinator } from './experience-route-coordinator';
/** Private commerce stays simulated; published requests use the trusted host. */
export function createFrameDispatcher({
  host,
  launch,
  nav,
  setLink,
  routes,
}: {
  host?: PublishedExperienceFrameHost;
  launch: ExperienceFrameLaunch;
  nav: ReturnType<typeof createNavigationPresentation>;
  setLink: (link: PresentedCanonicalLink | null) => void;
  routes: ReturnType<typeof createRouteCoordinator>;
}) {
  return host
    ? async (request: import('@baci/shared/experience').BridgeRequest) => {
        if (request.method === 'navigation.open') {
          const path = await host.resolveNavigation(String(request.args.path));
          const presented = nav.presentCanonicalLink(
            {
              requestId: request.requestId,
              path,
            },
            path
          );
          setLink(presented);
          return { status: 'ok' as const, value: { presented: true } };
        }
        return await host.dispatch(request);
      }
    : createPreviewDispatcher(launch.bootstrap, {
        open(path, requestId) {
          const presented = nav.presentCanonicalLink({ requestId, path });
          setLink(presented);
          return Promise.resolve({
            status: 'ok',
            value: { presented: true },
          });
        },
        go(path) {
          nav.cancel();
          setLink(null);
          canonicalExperiencePath(
            launch.canonicalBase,
            launch.routes.map((r) => r.path),
            path
          );
          return routes
            .transitionRoute(
              path,
              async () => launch.bootstrap.catalog.revision,
              resolveExperienceRoute(launch.routes, path)?.view ?? path,
              resolveExperienceRoute(launch.routes, path)?.params ?? {}
            )
            .then((route) => ({ status: 'ok' as const, value: route }));
        },
      });
}
