import type {} from './hooks/use-openai-global';

type WidgetHost = NonNullable<Window['openai']>;
let standardHost: WidgetHost | undefined;

/** Keep the standard adapter separate from the host-owned ChatGPT extension. */
export function getWidgetHost(): WidgetHost | undefined {
  return standardHost ?? window.openai;
}

export function resetWidgetHost() {
  standardHost = undefined;
}

export function updateWidgetHost(globals: Partial<WidgetHost>) {
  standardHost = { ...getWidgetHost(), ...globals };
  window.dispatchEvent(
    new CustomEvent('openai:set_globals', { detail: { globals } }),
  );
}
