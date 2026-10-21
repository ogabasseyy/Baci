'use client';

import {
  Component,
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useState,
} from 'react';
import type { TemplatePageProps } from './template-page-props';

interface DeferredTemplateErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

interface DeferredTemplateErrorBoundaryState {
  hasError: boolean;
}

class DeferredTemplateErrorBoundary extends Component<
  DeferredTemplateErrorBoundaryProps,
  DeferredTemplateErrorBoundaryState
> {
  state: DeferredTemplateErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): DeferredTemplateErrorBoundaryState {
    return { hasError: true };
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
    this.props.onRetry();
  };

  render() {
    if (this.state.hasError) {
      return (
        <section
          role="alert"
          aria-live="assertive"
          className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 py-12 text-center"
        >
          <p className="text-base font-medium">
            Unable to load storefront view.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded-md border px-4 py-2 text-sm font-medium"
          >
            Retry
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}

function DeferredTemplateLoadingFallback() {
  return (
    <div
      role="status"
      aria-label="Loading storefront"
      className="min-h-[50vh] w-full animate-pulse"
    />
  );
}

export function createDeferredTemplateHome(
  loadHome: () => Promise<ComponentType<TemplatePageProps>>
): ComponentType<TemplatePageProps> {
  const createLazyHome = () =>
    lazy(async () => ({
      default: await loadHome(),
    }));

  let initialLazyHome: ComponentType<TemplatePageProps> | null = null;
  const getInitialLazyHome = () => {
    if (!initialLazyHome) {
      initialLazyHome = createLazyHome();
    }
    return initialLazyHome;
  };

  function DeferredTemplateHome(props: TemplatePageProps) {
    const [LazyHome, setLazyHome] =
      useState<ComponentType<TemplatePageProps>>(getInitialLazyHome);

    const handleRetry = () => {
      initialLazyHome = createLazyHome();
      setLazyHome(() => initialLazyHome as ComponentType<TemplatePageProps>);
    };

    return (
      <DeferredTemplateErrorBoundary onRetry={handleRetry}>
        <Suspense fallback={<DeferredTemplateLoadingFallback />}>
          <LazyHome {...props} />
        </Suspense>
      </DeferredTemplateErrorBoundary>
    );
  }

  return DeferredTemplateHome;
}

function createRegistryTemplateHome(
  loaderKey: keyof typeof import('./registry-client-home-loaders')
): ComponentType<TemplatePageProps> {
  return createDeferredTemplateHome(async () => {
    const loaders = await import('./registry-client-home-loaders');
    return loaders[loaderKey]();
  });
}

export const ElectronicsTemplateHome = createRegistryTemplateHome(
  'loadElectronicsTemplateHome'
);

export const FashionTemplateHome = createRegistryTemplateHome(
  'loadFashionTemplateHome'
);

export const HomeGoodsTemplateHome = createRegistryTemplateHome(
  'loadHomeGoodsTemplateHome'
);

export const FoodBeverageTemplateHome = createRegistryTemplateHome(
  'loadFoodBeverageTemplateHome'
);

export const HealthBeautyTemplateHome = createRegistryTemplateHome(
  'loadHealthBeautyTemplateHome'
);

export const HairExtensionsTemplateHome = createRegistryTemplateHome(
  'loadHairExtensionsTemplateHome'
);

export const PharmaceuticalsTemplateHome = createRegistryTemplateHome(
  'loadPharmaceuticalsTemplateHome'
);

export const GadgetUniverseTemplateHome = createRegistryTemplateHome(
  'loadGadgetUniverseTemplateHome'
);

export const GadgetsProTemplateHome = createRegistryTemplateHome(
  'loadGadgetsProTemplateHome'
);

export const HandmadeTemplateHome = createRegistryTemplateHome(
  'loadHandmadeTemplateHome'
);

