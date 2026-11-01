const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class StrictJsonParser {
  private position = 0;

  constructor(
    private readonly source: string,
    private readonly maxDepth: number
  ) {}

  parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.position !== this.source.length) this.fail();
    return value;
  }

  private parseValue(depth = 0): unknown {
    if (depth > this.maxDepth) throw new Error('capture limit exceeded');
    this.skipWhitespace();
    const character = this.source[this.position];
    if (character === '{') return this.parseObject(depth);
    if (character === '[') return this.parseArray(depth);
    if (character === '"') return this.parseString();
    if (character === 't') return this.parseLiteral('true', true);
    if (character === 'f') return this.parseLiteral('false', false);
    if (character === 'n') return this.parseLiteral('null', null);
    return this.parseNumber();
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.position += 1;
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.consume('}')) return result;

    while (true) {
      this.skipWhitespace();
      if (this.source[this.position] !== '"') this.fail();
      const key = this.parseString();
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.skipWhitespace();
      if (!this.consume(':')) this.fail();
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: this.parseValue(depth + 1),
        writable: true,
      });
      this.skipWhitespace();
      if (this.consume('}')) return result;
      if (!this.consume(',')) this.fail();
    }
  }

  private parseArray(depth: number): unknown[] {
    this.position += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.consume(']')) return result;

    while (true) {
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      if (this.consume(']')) return result;
      if (!this.consume(',')) this.fail();
    }
  }

  private parseString(): string {
    const start = this.position;
    this.position += 1;
    let escaped = false;

    while (this.position < this.source.length) {
      const character = this.source[this.position];
      if (!escaped && character === '"') {
        this.position += 1;
        try {
          return JSON.parse(this.source.slice(start, this.position)) as string;
        } catch {
          this.fail();
        }
      }
      if (
        !escaped &&
        character !== undefined &&
        character.charCodeAt(0) < 0x20
      ) {
        this.fail();
      }
      if (!escaped && character === '\\') {
        escaped = true;
      } else {
        escaped = false;
      }
      this.position += 1;
    }
    this.fail();
  }

  private parseNumber(): number {
    JSON_NUMBER.lastIndex = this.position;
    const match = JSON_NUMBER.exec(this.source);
    if (!match) this.fail();
    this.position = JSON_NUMBER.lastIndex;
    return Number(match[0]);
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (!this.source.startsWith(literal, this.position)) this.fail();
    this.position += literal.length;
    return value;
  }

  private consume(character: string): boolean {
    if (this.source[this.position] !== character) return false;
    this.position += 1;
    return true;
  }

  private skipWhitespace(): void {
    while (' \t\n\r'.includes(this.source[this.position] ?? '\u0000')) {
      this.position += 1;
    }
  }

  private fail(): never {
    throw new Error('not canonical evidence');
  }
}

export function parseStrictJson(serialized: string, maxDepth = 32): unknown {
  try {
    return new StrictJsonParser(serialized, maxDepth).parse();
  } catch (error) {
    if (error instanceof Error && error.message === 'capture limit exceeded')
      throw error;
    throw new Error('not canonical evidence');
  }
}
