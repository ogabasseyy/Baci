import callSiteIndex from './validate-fastfile-call-site-index.cjs';

describe('callSiteIndex', () => {
  it('finds a bare call site', () => {
    expect(callSiteIndex('  do_thing(\n', 'do_thing')).toBeGreaterThanOrEqual(
      0
    );
  });

  it('finds a return-guarded call site', () => {
    expect(
      callSiteIndex('  return true if do_thing(\n', 'do_thing')
    ).toBeGreaterThanOrEqual(0);
  });

  it('finds an unless-guarded call site', () => {
    expect(
      callSiteIndex('  unless do_thing(\n', 'do_thing')
    ).toBeGreaterThanOrEqual(0);
  });

  it('ignores the def line that shares the name', () => {
    expect(callSiteIndex('def do_thing(\nend', 'do_thing')).toBe(-1);
  });

  it('returns -1 when the method is never called', () => {
    expect(callSiteIndex('  other_thing(\n', 'do_thing')).toBe(-1);
  });

  it('escapes ? and ! in method names', () => {
    expect(callSiteIndex('  ready?(\n', 'ready?')).toBeGreaterThanOrEqual(0);
    expect(callSiteIndex('  readyX(\n', 'ready?')).toBe(-1);
    expect(callSiteIndex('  ensure_thing!(\n', 'ensure_thing!')).toBeGreaterThanOrEqual(
      0
    );
  });
});
