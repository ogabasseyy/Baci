const EXECUTION_FAILURES = [
  /bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted/i,
  /permission profiles requiring direct runtime enforcement are incompatible with --use-legacy-landlock/i,
];

const FAILURE_CLASSIFIERS = [
  ['quota_or_usage_limit', /\b(?:usage limits?|quota|rate limit)\b/i],
  [
    'authentication_failure',
    /\b(?:authentication|unauthorized|not authenticated|login required)\b/i,
  ],
  [
    'toolchain_failure',
    /\b(?:command not found|enoent|eacces|failed to spawn|toolchain)\b/i,
  ],
];

const MAX_SUBPROCESS_OUTPUT_CHARS = 2_000;

const SENSITIVE_OUTPUT_PATTERNS = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
  [
    /(?:\+\d{1,3}[\s.-]?)\d(?:[\d\s().-]{6,}\d)|\b\d{3,4}[\s-]\d{3,4}[\s-]\d{3,5}\b/g,
    '[REDACTED_PHONE]',
  ],
  [/\b0\d{10}\b/g, '[REDACTED_PHONE]'],
  [/(\bauthorization\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]'],
  [/(\b(?:set-)?cookie\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]'],
  [
    /((?:"authorization"|'authorization'|authorization)\s*[:=]\s*["']?)[^"'\r\n,}\]]+(?:\s+[^"'\r\n,}\]]+)?/gi,
    '$1[REDACTED]',
  ],
  [
    /((?:"(?:set-)?cookie"|'(?:set-)?cookie'|(?:set-)?cookie)\s*[:=]\s*["']?)[^"'\r\n,}\]]+/gi,
    '$1[REDACTED]',
  ],
  [/\bbearer\s+[a-z0-9._~+/-]{16,}\b/gi, 'Bearer [REDACTED]'],
  [
    /((?:["'][^"']*(?:token|secret|password|api[-_]?key)[^"']*["']|[a-z0-9_-]*(?:token|secret|password|api[-_]?key)[a-z0-9_-]*)\s*[:=]\s*["']?)[^"'\s,}\]]+/gi,
    '$1[REDACTED]',
  ],
  [
    /\b(?:sk-(?:proj-|live-|test-)?|sk_(?:live|test)_|gh[opsu]_|github_pat_|xox[abprs]-|AIza)[a-z0-9_-]{16,}\b/gi,
    '[REDACTED]',
  ],
  [/(zoho-enczapikey\s+)[^\s"',]+/gi, '$1[REDACTED]'],
];

function tail(value, maxChars = MAX_SUBPROCESS_OUTPUT_CHARS) {
  const text = String(value || '');
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function normalizeExecution(execution) {
  if (typeof execution === 'string') {
    return { status: 0, stderr: '', stdout: execution };
  }
  return {
    status: execution?.status ?? 0,
    signal: execution?.signal || '',
    stderr: execution?.stderr || '',
    stdout: execution?.stdout || '',
  };
}

function parseJsonlEvents(output) {
  return String(output || '')
    .split('\n')
    .flatMap((line, index) => {
      if (!line.trim()) {
        return [];
      }
      try {
        const event = JSON.parse(line);
        if (
          !event ||
          typeof event !== 'object' ||
          typeof event.type !== 'string'
        ) {
          throw new Error('not a protocol event');
        }
        return [event];
      } catch {
        throw new Error(
          `Codex execution produced invalid JSONL at line ${index + 1}`
        );
      }
    });
}

function classifyFailure(output) {
  return FAILURE_CLASSIFIERS.find(([, pattern]) => pattern.test(output))?.[0];
}

export function formatBoundedSubprocessOutput({ stderr, stdout }) {
  return [
    stdout ? `stdout (tail): ${tail(redactCodexOutput(stdout))}` : '',
    stderr ? `stderr (tail): ${tail(redactCodexOutput(stderr))}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function redactCodexOutput(value) {
  return SENSITIVE_OUTPUT_PATTERNS.reduce(
    (output, [pattern, replacement]) => output.replace(pattern, replacement),
    String(value || '')
  );
}

export function redactCodexError(error) {
  return new Error(
    redactCodexOutput(error instanceof Error ? error.message : String(error))
  );
}

export function assertCodexExecutionUsable(execution) {
  const normalized = normalizeExecution(execution);
  const status = normalized.status;
  const signal = normalized.signal;
  const stderr = normalized.stderr;
  const stdout = normalized.stdout;
  const text = `${stdout}\n${stderr}`;
  const failure = EXECUTION_FAILURES.find((pattern) => pattern.test(text));
  if (failure) {
    throw new Error(
      'Codex execution sandbox failed before repository inspection'
    );
  }

  const classification = classifyFailure(text);
  if (status !== 0 || signal) {
    throw new Error(
      `Codex execution failed (${classification || 'process_failure'}${signal ? `; signal=${signal}` : ''}): ${formatBoundedSubprocessOutput({ stderr, stdout })}`
    );
  }

  const events = parseJsonlEvents(stdout);
  const types = events.map((event) => event.type);
  if (types.includes('turn.failed') || types.includes('error')) {
    throw new Error(
      `Codex execution reported ${types.includes('turn.failed') ? 'turn.failed' : 'error'}${classification ? ` (${classification})` : ''}`
    );
  }
  if (events.at(-1)?.type !== 'turn.completed') {
    throw new Error(
      'Codex execution final protocol event must be turn.completed'
    );
  }
}
