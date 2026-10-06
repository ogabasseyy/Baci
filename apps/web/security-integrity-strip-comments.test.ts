/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { stripComments } from './security-integrity-strip-comments';

describe('security-integrity-strip-comments', () => {
  it('strips block, full-line, and trailing comments', () => {
    const source = [
      '/* hasClass.indexOf(ind) */',
      '// hasClass.indexOf(ind)',
      '  // hasClass.indexOf(ind)',
      'foo(); // hasClass.indexOf(ind)',
      'bar();// hasClass.indexOf(ind)',
      'real(hasClass.indexOf(ind));',
    ].join('\n');
    const stripped = stripComments(source);
    expect(stripped).not.toContain('foo(); //');
    expect(stripped).not.toContain('bar();//');
    // The one genuine code occurrence survives.
    expect(stripped).toContain('real(hasClass.indexOf(ind));');
  });

  it('never strips inside strings or urls', () => {
    const source = [
      'const a = "x // hasClass.indexOf(ind)";',
      "const b = 'y // hasClass.indexOf(ind)';",
      'const c = `z // hasClass.indexOf(ind)`;',
      'const u = "https://example.invalid/hasClass.indexOf(ind)";',
    ].join('\n');
    // Conservative by design: the whole lines survive, so a real
    // marker can never be hidden (fail-closed, never fail-open).
    expect(stripComments(source)).toBe(source);
  });

  it('keeps division-adjacent tails instead of guessing', () => {
    const line = 'const q = a / b; // hasClass.indexOf(ind)';
    expect(stripComments(line)).toBe(line);
  });

  it('never strips block delimiters inside quoted strings', () => {
    // The delimiters are data here: stripping them would remove the
    // real call between them and false-pass the negative gate.
    const line = 'const a = "/*"; hasClass.indexOf(ind); const b = "*/";';
    expect(stripComments(line)).toBe(line);
    expect(stripComments(line)).toContain('hasClass.indexOf(ind)');
  });

  it('still strips real block comments around strings', () => {
    const source = 'const a = "x"; /* gone */ foo();\n/* multi\nline */bar();';
    expect(stripComments(source)).toBe('const a = "x";  foo();\nbar();');
  });

  it('keeps an unterminated block comment verbatim', () => {
    const line = 'foo(); /* hasClass.indexOf(ind)';
    expect(stripComments(line)).toBe(line);
  });
});
