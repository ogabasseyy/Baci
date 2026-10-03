# shellcheck shell=bash
# Shared dotenv reader for the GIGL gate scripts. Source it; do not execute:
#   . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gigl-dotenv.sh"
#
# gigl_dotenv_value <file> <key> prints the dotenv value for KEY in FILE
# (last assignment wins). Subset, verified against dotenv 17.4.2 (which
# the capability smoke loads): optional leading whitespace, optional
# `export` prefix, `=` (spaces around) or `:` (no space before, blank
# after) separator. A carriage return always ends the record (dotenv
# normalizes CR to LF before parsing). When the first non-blank value
# character is a quote, the region closes at the LAST same-quote whose
# every interior same-quote is backslash-escaped (an interior quote is
# escaped iff immediately preceded by a backslash — a backslash run
# never "uses up" the escape) and whose tail is blank-or-comment; this
# reproduces dotenv's greedy match with backtracking, including the
# fallback to an unquoted parse (cut at the first `#`, then strip one
# layer of matched surrounding quotes) when no usable closer exists.
# `\n` / `\r` expand exactly as dotenv parses them — whenever the
# trimmed value starts with a double quote, even unstripped — while
# every other escape stays literal. Multiline values are out of subset
# (the preflight rejects them for shell-read keys).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo 'gigl-dotenv.sh must be sourced, not executed' >&2
  exit 2
fi

gigl_dotenv_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  awk -v key="$key" -v dq='"' -v sq="'" -v bq='`' '
    {
      line = $0
      sub(/\r.*$/, "", line)
      sub(/^[ \t]+/, "", line)
      sub(/^export[ \t]+/, "", line)
      if (substr(line, 1, length(key)) != key) next
      rest = substr(line, length(key) + 1)
      if (substr(rest, 1, 1) == ":" && substr(rest, 2, 1) ~ /[ \t]/) {
        # dotenv colon separator: no blank before the colon, blank
        # after (`KEY: value`; `KEY : v` and `KEY:v` are ignored
        # lines, matched by falling through to the `=` check below).
        value = substr(rest, 2)
      } else {
        sub(/^[ \t]+/, "", rest)
        if (substr(rest, 1, 1) != "=") next
        value = substr(rest, 2)
      }
      opener_at = match(value, /[^ \t]/)
      opener = opener_at ? substr(value, opener_at, 1) : ""
      if (opener == dq || opener == sq || opener == bq) {
        nq = 0
        for (i = opener_at + 1; i <= length(value); i++)
          if (substr(value, i, 1) == opener) qpos[++nq] = i
        closer = 0
        for (k = nq; k >= 1; k--) {
          candidate = qpos[k]
          interior_ok = 1
          for (j = opener_at + 1; j < candidate; j++) {
            if (substr(value, j, 1) == opener && substr(value, j - 1, 1) != "\\") {
              interior_ok = 0
              break
            }
          }
          if (!interior_ok) continue
          if (substr(value, candidate + 1) ~ /^[ \t]*(#.*)?$/) {
            closer = candidate
            break
          }
        }
        if (closer > 0) {
          inner = substr(value, opener_at + 1, closer - opener_at - 1)
          if (opener == dq) {
            # dotenv expands \n and \r when the value opens with a
            # double quote. gsub scans single-pass like the dotenv
            # replace, so `\\n` yields a literal backslash plus a
            # newline in both.
            gsub(/\\n/, "\n", inner)
            gsub(/\\r/, "\r", inner)
          }
          found = inner
          have_value = 1
          next
        }
        # No usable closer (or junk after it): dotenv falls back to
        # an unquoted parse of the whole value below.
      }
      hash_at = index(value, "#")
      if (hash_at > 0) value = substr(value, 1, hash_at - 1)
      sub(/^[ \t]+/, "", value)
      sub(/[ \t]+$/, "", value)
      # dotenv strips one layer of matched surrounding quotes even on
      # the unquoted fallback, and expands when the trimmed value
      # starts with a double quote even when nothing is stripped.
      maybe_double = (substr(value, 1, 1) == dq)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      if (length(value) >= 2 && (first == dq || first == sq || first == bq) && last == first)
        value = substr(value, 2, length(value) - 2)
      if (maybe_double) {
        gsub(/\\n/, "\n", value)
        gsub(/\\r/, "\r", value)
      }
      found = value
      have_value = 1
    }
    END { if (have_value) print found }
  ' "$file" 2>/dev/null || true
}
