"""Loads the latest real function and trigger definitions from supabase/migrations."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]


def real_function(name, schema='public'):
    """The latest CREATE OR REPLACE FUNCTION <schema>.<name> in supabase/migrations, verbatim."""
    head = re.compile(r'CREATE OR REPLACE FUNCTION "?' + schema + r'"?\."?' + name + r'"?\(')
    sources = sorted(path for path in (ROOT / 'supabase/migrations').glob('*.sql')
                     if head.search(path.read_text(encoding='utf-8')))
    if not sources:
        raise RuntimeError(f'no migration defines {schema}.{name}')
    text = sources[-1].read_text(encoding='utf-8')
    body = text[list(head.finditer(text))[-1].start():]
    tag = re.search(r'\bAS\s+(\$[a-z_]*\$)', body, re.I)
    end = body.index(tag.group(1) + ';', tag.end())
    return body[:end + len(tag.group(1)) + 1]


def real_trigger(name, function):
    """The latest migration's function and CREATE TRIGGER <name> statement, verbatim."""
    head = re.compile(r'CREATE (?:OR REPLACE )?TRIGGER "?' + name + r'"?\b')
    sources = sorted(path for path in (ROOT / 'supabase/migrations').glob('*.sql')
                     if head.search(path.read_text(encoding='utf-8')))
    if not sources:
        raise RuntimeError(f'no migration defines trigger {name}')
    text = sources[-1].read_text(encoding='utf-8')
    start = list(head.finditer(text))[-1].start()
    return real_function(function) + '\n' + text[start:text.index(';', start) + 1]
