import stripRubyComments from './validate-fastfile-strip-ruby-comments.cjs';

describe('stripRubyComments', () => {
  it('removes full-line comments', () => {
    expect(stripRubyComments('# leading comment\nx = 1')).toBe('\nx = 1');
  });

  it('strips trailing comments but keeps the code', () => {
    expect(stripRubyComments('x = 1 # set x')).toBe('x = 1 ');
  });

  it('preserves octothorpes glued inside strings', () => {
    expect(stripRubyComments('url = "a#b"')).toBe('url = "a#b"');
  });

  it('removes =begin/=end documentation blocks', () => {
    expect(
      stripRubyComments('before\n=begin\nignored\n=end\nafter')
    ).toBe('before\nafter');
  });

  it('leaves ordinary lines untouched', () => {
    expect(stripRubyComments('def foo\n  bar\nend')).toBe('def foo\n  bar\nend');
  });

  it('handles empty source', () => {
    expect(stripRubyComments('')).toBe('');
  });
});
