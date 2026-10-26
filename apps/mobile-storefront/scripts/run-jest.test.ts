describe('bugfix: Node 24 Sparkplug GC crash in the full Jest suite', () => {
  it('disables Sparkplug before Jest creates test VM contexts', () => {
    expect(process.execArgv).toContain('--no-sparkplug');
  });
});
