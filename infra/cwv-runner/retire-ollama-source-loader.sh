#!/bin/sh
# Snapshot a reviewed helper from a held inode before sourcing it.

source_loader_snapshot_file() {
  /usr/bin/perl -MFcntl=O_RDONLY,O_NOFOLLOW,O_WRONLY,O_TRUNC -e '
my($src,$dst)=@ARGV; sub fail { exit 2 }
sub sameid { my($a,$b)=@_; return @$a && @$b && $a->[0]==$b->[0] && $a->[1]==$b->[1] && $a->[2]==$b->[2] && $a->[3]==$b->[3] && $a->[4]==$b->[4] && $a->[5]==$b->[5] }
sub same { my($a,$b)=@_; return sameid($a,$b) && $a->[7]==$b->[7] && $a->[9]==$b->[9] && $a->[10]==$b->[10] }
my@before=lstat($src); fail() unless @before && ($before[2]&0170000)==0100000 && $before[3]==1;
sysopen(my$in,$src,O_RDONLY|O_NOFOLLOW) or fail(); my@opened=stat($in); fail() unless same(\@before,\@opened);
my$bytes=""; while(1){ my$n=sysread($in,my$chunk,65536); defined$n or fail(); last unless$n; $bytes.=$chunk; length($bytes)<=8388608 or fail() }
my@after=lstat($src); fail() unless same(\@opened,\@after); close($in) or fail();
my@target=lstat($dst); fail() unless @target && ($target[2]&0170000)==0100000 && $target[3]==1;
sysopen(my$out,$dst,O_WRONLY|O_TRUNC|O_NOFOLLOW) or fail(); my@written=stat($out); fail() unless sameid(\@target,\@written);
my$offset=0; while($offset<length($bytes)){ my$n=syswrite($out,$bytes,length($bytes)-$offset,$offset); defined$n&&$n>0 or fail(); $offset+=$n } close($out) or fail();
' "$1" "$2"
}

source_loader_digest_file() {
  local source_loader_digest_output source_loader_digest
  if [ -x /usr/bin/sha256sum ]; then
    source_loader_digest_output=$(/usr/bin/sha256sum "$1") || return 2
  elif [ -x /usr/bin/shasum ]; then
    source_loader_digest_output=$(/usr/bin/shasum -a 256 "$1") || return 2
  else
    return 2
  fi
  source_loader_digest=${source_loader_digest_output%%[[:space:]]*}
  case "$source_loader_digest" in ''|*[!a-f0-9]*) return 2;; esac
  [ "${#source_loader_digest}" -eq 64 ] || return 2
  printf '%s\n' "$source_loader_digest"
}

source_loader_source() {
  local source_loader_input=$1 source_loader_dir source_loader_snapshot_dir source_loader_snapshot source_loader_digest source_loader_status source_loader_parent_depth source_loader_fd source_loader_snapshot_identity source_loader_fd_identity
  SOURCE_LOADER_DIGEST=
  [ -f "$source_loader_input" ] && [ ! -L "$source_loader_input" ] || return 2
  source_loader_parent_depth=${SOURCE_LOADER_DEPTH:-0}; case "$source_loader_parent_depth" in ''|*[!0-9]*) return 2;; esac
  source_loader_fd=$((9 - source_loader_parent_depth)); case "$source_loader_fd" in 3|4|5|6|7|8|9) :;; *) return 2;; esac
  SOURCE_LOADER_DEPTH=$((source_loader_parent_depth + 1))
  source_loader_dir=${source_loader_input%/*}; [ "$source_loader_dir" = "$source_loader_input" ] && source_loader_dir=.
  if [ -n "${TEMP_ROOT:-}" ]; then
    type temp_root_verify_root >/dev/null 2>&1 || { SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
    temp_root_verify_root || { SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
    source_loader_snapshot_dir=$TEMP_ROOT
  else
    source_loader_snapshot_dir=$source_loader_dir
  fi
  source_loader_snapshot=$(/usr/bin/mktemp "$source_loader_snapshot_dir/.retire-ollama-source.XXXXXX") || { SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  source_loader_snapshot_file "$source_loader_input" "$source_loader_snapshot" || { /bin/rm -f -- "$source_loader_snapshot"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  source_loader_digest=$(source_loader_digest_file "$source_loader_snapshot") || { /bin/rm -f -- "$source_loader_snapshot"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  source_loader_snapshot_identity=$(/usr/bin/perl -e '@s=stat($ARGV[0]); @s || exit 2; print join(":", @s[0,1,2,3,4,5]), "\n"' "$source_loader_snapshot") || { /bin/rm -f -- "$source_loader_snapshot"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  eval "exec ${source_loader_fd}<\"\$source_loader_snapshot\"" || { /bin/rm -f -- "$source_loader_snapshot"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  source_loader_fd_identity=$(SOURCE_LOADER_FD=$source_loader_fd /usr/bin/perl -e '$fd=$ENV{SOURCE_LOADER_FD}; open(my$f,"<&=",$fd) || exit 2; @s=stat($f); @s || exit 2; print join(":", @s[0,1,2,3,4,5]), "\n"') || { /bin/rm -f -- "$source_loader_snapshot"; eval "exec ${source_loader_fd}<&-"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  [ "$source_loader_snapshot_identity" = "$source_loader_fd_identity" ] || { /bin/rm -f -- "$source_loader_snapshot"; eval "exec ${source_loader_fd}<&-"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  /bin/rm -f -- "$source_loader_snapshot" || { eval "exec ${source_loader_fd}<&-"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  [ ! -e "$source_loader_snapshot" ] || { eval "exec ${source_loader_fd}<&-"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }
  . "/dev/fd/$source_loader_fd"
  source_loader_status=$?
  eval "exec ${source_loader_fd}<&-" || source_loader_status=2
  SOURCE_LOADER_DEPTH=$source_loader_parent_depth
  [ "$source_loader_status" -eq 0 ] && SOURCE_LOADER_DIGEST=$source_loader_digest
  return "$source_loader_status"
}
