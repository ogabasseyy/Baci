# shellcheck shell=bash
# Shared dotenv reader for the GIGL gate scripts. Source it; do not execute:
#   . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gigl-dotenv.sh"
#
# gigl_dotenv_value <file> <key> prints the dotenv value for KEY in FILE
# (last assignment wins). Subset, verified against dotenv 17.4.2 (which
# the capability smoke loads): optional leading whitespace, optional
# `export` prefix, spaces around `=`, one layer of matched surrounding
# quotes stripped, otherwise a quote-aware trailing `#` comment stripped.
# Prints nothing when the file or key is absent. Anything else (multiline
# values, escapes) is out of subset and parses literally.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo 'gigl-dotenv.sh must be sourced, not executed' >&2
  exit 2
fi

gigl_dotenv_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  awk -v key="$key" -v dq='"' -v sq="'" '
    {
      line = $0
      sub(/^[ \t]+/, "", line)
      sub(/^export[ \t]+/, "", line)
      if (substr(line, 1, length(key)) != key) next
      rest = substr(line, length(key) + 1)
      sub(/^[ \t]+/, "", rest)
      if (substr(rest, 1, 1) != "=") next
      value = substr(rest, 2)
      # Strip a trailing `#` comment, honoring single/double quotes the
      # way dotenv does (a `#` inside quotes is data, not a comment).
      uncommented = ""
      quote = ""
      for (i = 1; i <= length(value); i++) {
        char = substr(value, i, 1)
        if (quote == "") {
          if (char == "#") break
          if (char == dq || char == sq) quote = char
        } else if (char == quote) {
          quote = ""
        }
        uncommented = uncommented char
      }
      value = uncommented
      sub(/^[ \t]+/, "", value)
      sub(/[ \t\r]+$/, "", value)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      if (length(value) >= 2 && (first == dq || first == sq) && (last == dq || last == sq)) {
        value = substr(value, 2, length(value) - 2)
      }
      found = value
      have_value = 1
    }
    END { if (have_value) print found }
  ' "$file" 2>/dev/null || true
}
