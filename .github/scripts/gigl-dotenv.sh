# shellcheck shell=bash
# Shared dotenv reader for the GIGL gate scripts. Source it; do not execute:
#   . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gigl-dotenv.sh"
#
# gigl_dotenv_value <file> <key> prints the dotenv value for KEY in FILE
# (last assignment wins). Subset, verified against dotenv 17.4.2 (which
# the capability smoke loads): optional leading whitespace, optional
# `export` prefix, `=` (spaces around) or `:` (no space before, blank
# after) separator, one layer of matched surrounding quotes
# (single/double/backtick) stripped, otherwise a quote-aware trailing
# `#` comment stripped. Prints nothing when the file or key is absent.
# Inside double quotes an escape never ends the quoted region (so a
# `#` after `\"` stays data), and `\n` / `\r` expand exactly as dotenv
# parses them; every other escape stays literal, as do single-quoted,
# backtick-quoted, and unquoted values. Multiline values are out of
# subset.
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
      sub(/^[ \t]+/, "", line)
      sub(/^export[ \t]+/, "", line)
      if (substr(line, 1, length(key)) != key) next
      rest = substr(line, length(key) + 1)
      if (substr(rest, 1, 1) == ":" && substr(rest, 2, 1) ~ /[ \t\r]/) {
        # dotenv colon separator: no blank before the colon, blank
        # after (`KEY: value`; `KEY : v` and `KEY:v` are ignored
        # lines, matched by falling through to the `=` check below).
        value = substr(rest, 2)
      } else {
        sub(/^[ \t]+/, "", rest)
        if (substr(rest, 1, 1) != "=") next
        value = substr(rest, 2)
      }
      # Strip a trailing `#` comment, honoring single/double quotes the
      # way dotenv does (a `#` inside quotes is data, not a comment).
      uncommented = ""
      quote = ""
      seen_data = 0
      for (i = 1; i <= length(value); i++) {
        char = substr(value, i, 1)
        if (quote == dq && char == "\\" && i < length(value)) {
          # An escape inside double quotes: copy both characters
          # literally (escapes stay literal per the subset contract)
          # without letting an escaped quote end the quoted region,
          # or a `#` after it would wrongly start a comment.
          i++
          uncommented = uncommented char substr(value, i, 1)
        } else if (quote == "") {
          if (char == "#") break
          # Only a LEADING quote opens a quoted region: dotenv treats
          # a quote past the first non-whitespace character as data
          # (abc"def#ghi parses to abc"def, comment stripped), so
          # opening mid-value would preserve a `#` dotenv drops and
          # hand the poller different bytes than the preflight saw.
          # Backtick joins single/double here (the third dotenv
          # quoted form); like single quotes it is raw below (escapes
          # are honored inside double quotes only).
          if (char == dq || char == sq || char == bq) {
            if (!seen_data) quote = char
          } else if (char != " " && char != "\t" && char != "\r") {
            seen_data = 1
          }
          uncommented = uncommented char
        } else {
          if (char == quote) quote = ""
          uncommented = uncommented char
        }
      }
      value = uncommented
      sub(/^[ \t]+/, "", value)
      sub(/[ \t\r]+$/, "", value)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      # Strip only MATCHED pairs: dotenv preserves mismatched wrapping
      # quotes (a double-quote opener with a single-quote closer stays
      # literal), so stripping them would hand the poller different
      # bytes than the preflight validated.
      if (length(value) >= 2 && (first == dq || first == sq || first == bq) && last == first) {
        double_quoted = (first == dq)
        value = substr(value, 2, length(value) - 2)
        if (double_quoted) {
          # dotenv expands \n and \r inside double quotes only
          # (single-quoted and unquoted values stay literal).
          # gsub scans single-pass like the dotenv replace, so `\\n`
          # yields a literal backslash plus a newline in both.
          gsub(/\\n/, "\n", value)
          gsub(/\\r/, "\r", value)
        }
      }
      found = value
      have_value = 1
    }
    END { if (have_value) print found }
  ' "$file" 2>/dev/null || true
}
