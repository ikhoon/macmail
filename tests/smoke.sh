#!/usr/bin/env bash
# Smoke tests for the compiled macmail binary.
#
# Verifies binary boots + every subcommand exposes --help + dry-run paths for
# write commands work. Does NOT exercise live read paths (those need Full
# Disk Access and a populated ~/Library/Mail).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MACMAIL="${SCRIPT_DIR}/../dist/macmail"

if [[ ! -x "$MACMAIL" ]]; then
  echo "macmail binary not found at $MACMAIL — run ./install.sh first" >&2
  exit 1
fi

PASS=0
FAIL=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n    %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

assert_match() {
  local desc="$1" pattern="$2" out="$3"
  if [[ "$out" == *"$pattern"* ]]; then pass "$desc"
  else fail "$desc" "expected to contain '$pattern', got: $(printf %s "$out" | head -1)"
  fi
}

assert_exits_nonzero() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$desc" "expected non-zero exit"
  else pass "$desc"
  fi
}

echo "macmail smoke tests"

# Version / help — assert the binary reports package.json's version (the single
# source src/cli.ts imports), falling back to a loose check when the manifest
# isn't alongside (e.g. smoke-testing a downloaded binary).
EXPECTED_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SCRIPT_DIR/../package.json" 2>/dev/null | head -1)
out=$("$MACMAIL" --version 2>&1)
assert_match "--version reports ${EXPECTED_VERSION:-a semver}" "${EXPECTED_VERSION:-.}" "$out"

out=$("$MACMAIL" --help 2>&1)
for sub in accounts mailboxes triage search read mark send reply completions; do
  assert_match "--help lists '$sub'" "$sub" "$out"
done

# Per-subcommand --help
for sub in accounts mailboxes triage search read mark send reply completions; do
  out=$("$MACMAIL" "$sub" --help 2>&1)
  assert_match "macmail $sub --help works" "Usage" "$out"
done

# search subcommand surfaces the filter + body-search flags
out=$("$MACMAIL" search --help 2>&1)
for flag in --since --until --sender --to --unread --flagged --count-only --snippet --body; do
  assert_match "search --help advertises $flag" "$flag" "$out"
done

# completions command emits installable scripts for zsh and bash
out=$("$MACMAIL" completions --shell zsh 2>&1)
assert_match "completions zsh emits compdef" "#compdef macmail" "$out"
out=$("$MACMAIL" completions --shell bash 2>&1)
assert_match "completions bash emits complete -F" "complete -F _macmail_complete" "$out"

# Write-command dry-runs (no Mail.app side effects)
out=$("$MACMAIL" mark 1 read --account Work --dry-run 2>&1)
assert_match "mark --dry-run prints summary" "DRY-RUN" "$out"

out=$("$MACMAIL" send --to a@x.com --subject s --body b --dry-run 2>&1)
assert_match "send --dry-run prints summary" "DRY-RUN" "$out"

out=$("$MACMAIL" reply 1 --body b --account Work --dry-run 2>&1)
assert_match "reply --dry-run prints summary" "DRY-RUN" "$out"

# Invalid input
assert_exits_nonzero "unknown subcommand fails" "$MACMAIL" nope
assert_exits_nonzero "mark with bad state fails" "$MACMAIL" mark 1 nope --dry-run
assert_exits_nonzero "send without --to fails" "$MACMAIL" send --subject s --body b --dry-run

echo
echo "passed: $PASS  failed: $FAIL"
exit $(( FAIL > 0 ))
