export const systemErrorClassNames = {
  actions: 'baci-system-error-actions',
  brand: 'baci-system-error-brand',
  button: 'baci-system-error-button',
  buttonSecondary: 'baci-system-error-button-secondary',
  card: 'baci-system-error-card',
  cardTitle: 'baci-system-error-card-title',
  copy: 'baci-system-error-copy',
  debug: 'baci-system-error-debug',
  icon: 'baci-system-error-icon',
  page: 'baci-system-error-page',
  shell: 'baci-system-error-shell',
  statusCode: 'baci-system-error-status-code',
  title: 'baci-system-error-title',
} as const;

export const systemErrorStyleSheet = `
.baci-system-error-page {
  --error-bg: #f8fafc;
  --error-card: #ffffff;
  --error-border: #e2e8f0;
  --error-text: #0f172a;
  --error-muted: #475569;
  --error-primary: #4f46e5;
  --error-primary-hover: #4338ca;
  --error-danger-bg: #fee2e2;
  --error-danger-text: #dc2626;
  --error-focus: #2563eb;

  align-items: center;
  background:
    radial-gradient(circle at top, rgba(79, 70, 229, 0.08), transparent 32rem),
    var(--error-bg);
  color: var(--error-text);
  display: flex;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif;
  inset: 0;
  justify-content: center;
  min-height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 1.5rem;
  position: fixed;
}

.baci-system-error-page,
.baci-system-error-page::before,
.baci-system-error-page::after,
.baci-system-error-page *,
.baci-system-error-page *::before,
.baci-system-error-page *::after {
  box-sizing: border-box;
}

.baci-system-error-shell {
  margin: 0 auto;
  max-width: 42rem;
  text-align: center;
  width: 100%;
}

.baci-system-error-card {
  background: var(--error-card);
  border: 1px solid var(--error-border);
  border-radius: 1.25rem;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
  margin: 0 auto;
  max-width: 30rem;
  padding: 2rem;
  text-align: center;
  width: 100%;
}

.baci-system-error-brand {
  color: var(--error-primary);
  display: inline-block;
  font-size: 0.875rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  margin-bottom: 1rem;
  text-decoration: none;
  text-transform: uppercase;
}

.baci-system-error-status-code {
  color: rgba(79, 70, 229, 0.12);
  font-size: clamp(5rem, 18vw, 10rem);
  font-weight: 900;
  line-height: 0.85;
  margin: 0 0 0.75rem;
}

.baci-system-error-icon {
  align-items: center;
  background: var(--error-danger-bg);
  border-radius: 999px;
  color: var(--error-danger-text);
  display: inline-flex;
  font-size: 1.5rem;
  font-weight: 800;
  height: 4rem;
  justify-content: center;
  margin-bottom: 1.25rem;
  width: 4rem;
}

.baci-system-error-title,
.baci-system-error-card-title {
  color: var(--error-text);
  font-weight: 800;
  line-height: 1.08;
  margin: 0;
}

.baci-system-error-title {
  font-size: clamp(1.875rem, 5vw, 3rem);
}

.baci-system-error-card-title {
  font-size: clamp(1.5rem, 4vw, 2rem);
}

.baci-system-error-copy {
  color: var(--error-muted);
  font-size: 1rem;
  line-height: 1.7;
  margin: 1rem auto 0;
  max-width: 34rem;
}

.baci-system-error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 1.75rem;
}

.baci-system-error-button {
  align-items: center;
  background: var(--error-primary);
  border: 1px solid var(--error-primary);
  border-radius: 999px;
  color: #ffffff;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 700;
  justify-content: center;
  min-height: 3rem;
  min-width: 9rem;
  padding: 0.75rem 1.25rem;
  text-decoration: none;
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease,
    outline-color 150ms ease,
    transform 150ms ease;
}

.baci-system-error-button:hover {
  background: var(--error-primary-hover);
  border-color: var(--error-primary-hover);
  transform: translateY(-1px);
}

.baci-system-error-button:focus-visible {
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18);
  outline: 3px solid var(--error-focus);
  outline-offset: 3px;
}

.baci-system-error-button-secondary {
  background: transparent;
  color: var(--error-primary);
}

.baci-system-error-button-secondary:hover {
  background: rgba(79, 70, 229, 0.08);
  border-color: rgba(79, 70, 229, 0.32);
  color: var(--error-primary-hover);
}

.baci-system-error-button-secondary:focus-visible {
  border-color: var(--error-focus);
}

.baci-system-error-debug {
  background: rgba(15, 23, 42, 0.06);
  border-radius: 0.75rem;
  color: var(--error-muted);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  font-size: 0.75rem;
  margin-top: 1.5rem;
  max-height: 12rem;
  overflow: auto;
  padding: 1rem;
  text-align: left;
  white-space: pre-wrap;
}

@media (prefers-color-scheme: dark) {
  .baci-system-error-page {
    --error-bg: #020617;
    --error-card: #0f172a;
    --error-border: #1e293b;
    --error-text: #f8fafc;
    --error-muted: #cbd5e1;
    --error-danger-bg: rgba(127, 29, 29, 0.38);
    --error-danger-text: #fca5a5;
    --error-focus: #93c5fd;
  }
}

@media (max-width: 520px) {
  .baci-system-error-card {
    padding: 1.5rem;
  }

  .baci-system-error-actions {
    flex-direction: column;
  }

  .baci-system-error-button {
    width: 100%;
  }
}

  @media (prefers-reduced-motion: reduce) {
  .baci-system-error-button {
    transition: none;
  }

  .baci-system-error-button:hover {
    transform: none;
  }
}
`
  .replace(/\s+/g, ' ')
  .replace(/\s*([{};])\s*/g, '$1')
  .trim();
