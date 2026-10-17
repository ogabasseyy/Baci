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

export const ElectronicsTemplateHome = createDeferredTemplateHome(async () => {
  const { GadgetDefaultTemplate } = await import(
    '@/components/storefront/templates/gadget-default-template'
  );
  return GadgetDefaultTemplate as ComponentType<TemplatePageProps>;
});

export const FashionTemplateHome = createDeferredTemplateHome(async () => {
  const { PremiumDefaultTemplate } = await import(
    '@/components/storefront/templates/premium-default'
  );
  return PremiumDefaultTemplate as ComponentType<TemplatePageProps>;
});

export const HomeGoodsTemplateHome = createDeferredTemplateHome(async () => {
  const { HomeGoodsHome } = await import('./home-goods');
  return HomeGoodsHome;
});

export const FoodBeverageTemplateHome = createDeferredTemplateHome(async () => {
  const { FoodBeverageHome } = await import('./food-beverage');
  return FoodBeverageHome;
});

export const HealthBeautyTemplateHome = createDeferredTemplateHome(async () => {
  const { BeautyHome } = await import('./beauty');
  return BeautyHome;
});

export const HairExtensionsTemplateHome = createDeferredTemplateHome(
  async () => {
    const { HairExtensionsHome } = await import('./hair-extensions');
    return HairExtensionsHome;
  }
);

export const PharmaceuticalsTemplateHome = createDeferredTemplateHome(
  async () => {
    const { PharmaceuticalHome } = await import('./pharmaceutical');
    return PharmaceuticalHome;
  }
);

export const GadgetUniverseTemplateHome = createDeferredTemplateHome(
  async () => {
    const { GadgetUniverseTemplate } = await import(
      '@/components/storefront/templates/gadget-universe'
    );
    return GadgetUniverseTemplate as unknown as ComponentType<TemplatePageProps>;
  }
);

export const GadgetsProTemplateHome = createDeferredTemplateHome(async () => {
  const { Home } = await import('@/components/storefront/new-template/home');
  return Home as ComponentType<TemplatePageProps>;
});

export const HandmadeTemplateHome = createDeferredTemplateHome(async () => {
  const { HandmadeHome } = await import('./artisan');
  return HandmadeHome;
});
