import extractIndentedBlock from './validate-fastfile-extract-indented-block.cjs';

describe('extractIndentedBlock', () => {
  it('extracts a method definition through its closing end', () => {
    const source = 'before\ndef foo\n  bar\nend\nafter';
    expect(extractIndentedBlock(source, /^\s*def\s+foo\b/, 'end')).toBe(
      'def foo\n  bar\nend'
    );
  });

  it('returns null when the declaration is missing', () => {
    expect(extractIndentedBlock('def foo\nend', /^\s*def\s+bar\b/, 'end')).toBe(
      null
    );
  });

  it('returns null when the closer is missing', () => {
    expect(
      extractIndentedBlock('def foo\n  bar', /^\s*def\s+foo\b/, 'end')
    ).toBe(null);
  });

  it('skips deeper-indented closers from nested blocks', () => {
    const source = 'def foo\n  items.each do\n  end\n  bar\nend';
    expect(extractIndentedBlock(source, /^\s*def\s+foo\b/, 'end')).toBe(source);
  });

  it('supports custom closing tokens', () => {
    const source = 'LIST = %w[\n  a\n].freeze\nafter';
    expect(extractIndentedBlock(source, /^\s*LIST\s*=/, '].freeze')).toBe(
      'LIST = %w[\n  a\n].freeze'
    );
  });

  it('scopes the closer to the declaration indentation', () => {
    const source = 'class A\n  def foo\n  end\nend';
    expect(extractIndentedBlock(source, /^\s*def\s+foo\b/, 'end')).toBe(
      '  def foo\n  end'
    );
  });
});
