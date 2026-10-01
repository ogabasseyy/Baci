export type SemanticRole = 'button' | 'checkbox' | 'link' | 'text' | 'textbox';

export interface SemanticAccessibilityState {
  readonly busy?: boolean;
  readonly disabled?: boolean;
}

export interface SemanticNode {
  readonly accessibilityLabel: string;
  readonly accessibilityRole?: SemanticRole;
  /** Native adapters may expose disabled as accessibility state. */
  readonly accessibilityState?: SemanticAccessibilityState;
  /** Kept for adapters that normalize native state before building a tree. */
  readonly enabled?: boolean;
}

export interface SemanticTarget {
  readonly label: string;
  readonly role?: SemanticRole;
}

export interface StabilityGateOptions {
  /** Number of complete runs required to pass. Defaults to three. */
  readonly repeats?: number;
}

export interface SemanticStepOptions<T> {
  readonly name: string;
  /** Runner-specific semantic readiness assertion before the action. */
  readonly before: () => void | Promise<void>;
  readonly action: () => T | Promise<T>;
  /** Runner-specific expected-state assertion after the action. */
  readonly after: (result: T) => void | Promise<void>;
}
