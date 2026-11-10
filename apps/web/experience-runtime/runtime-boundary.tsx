import type { PublicCatalog, RouteState } from '@baci/shared/experience';
import { Component, type ComponentType, type ReactNode } from 'react';

export interface ExperienceModule {
  default: ComponentType<{ route: RouteState; catalog: PublicCatalog }>;
}
/** Render errors are contained; the OS supervisor enforces CPU deadlines. */
export class RuntimeBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">Experience unavailable</p>
    ) : (
      this.props.children
    );
  }
}
