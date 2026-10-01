import type { BuilderData } from '@baci/shared/contracts';

export function isRenderedH1Hero(
  component: BuilderData['content'][number]
): boolean {
  return (
    component.type === 'Hero' && (component.props.headingLevel || 'h1') === 'h1'
  );
}
