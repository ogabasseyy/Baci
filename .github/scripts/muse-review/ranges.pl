# New-side diff ranges as JSON: [{"path","start","end"}].
#
# Usage: perl ranges.pl <unified-diff-file>
#
# Single-pass: C-escapes in +++ paths (octal, named, quote, backslash) are
# decoded and control chars JSON-escaped in one process, so there is no
# delimited handoff where a decoded tab/newline could corrupt record framing.
# Hunks for /dev/null (pure deletions) and zero-length new sides are skipped.
# Prints [] on any read failure; callers still validate with `jq empty`.
use strict;
use warnings;

my ($diff) = @ARGV;
my @out;
my $f;

if (defined $diff and open(my $fh, '<', $diff)) {
  while (my $line = <$fh>) {
    if ($line =~ /^\+\+\+ (.*)$/) {
      $f = $1;
      chomp $f;
      $f =~ s/^"(.*)"$/$1/;
      $f =~ s{^b/}{};
      $f =~ s/\\([0-7]{3}|[abtnfvr"\\])/length($1)==3?chr(oct($1)):($1 eq "a"?"\a":$1 eq "b"?"\b":$1 eq "t"?"\t":$1 eq "n"?"\n":$1 eq "v"?chr(11):$1 eq "f"?"\f":$1 eq "r"?"\r":$1)/ge;
    }
    if ($line =~ /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/ and defined $f and $f ne "/dev/null") {
      my $s = $1;
      my $l = (defined $2 ? $2 : 1);
      if ($l > 0) {
        my $e = $s + $l - 1;
        (my $j = $f) =~ s/\\/\\\\/g;
        $j =~ s/"/\\"/g;
        $j =~ s/([\x00-\x1f])/sprintf("\\u%04x", ord($1))/ge;
        push @out, "{\"path\":\"$j\",\"start\":$s,\"end\":$e}";
      }
    }
  }
  close $fh;
}
print "[" . join(",", @out) . "]";
