# bash completion for macmail (TS binary).
# Install: source this file from your ~/.bashrc, or drop it into
#   ~/.local/share/bash-completion/completions/macmail (bash-completion@2 auto-loads it).

# Helper: read newline-separated output from a command into `_macmail_names`,
# preserving names that contain spaces (compgen -W word-splits — we filter manually).
_macmail_collect() {
  _macmail_names=()
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    _macmail_names+=("$line")
  done < <("$@" 2>/dev/null)
}

# Helper: filter `_macmail_names` by `$cur` prefix into COMPREPLY, quoting embedded
# whitespace so the candidate stays a single completion word.
_macmail_reply_from_names() {
  COMPREPLY=()
  local n
  for n in "${_macmail_names[@]}"; do
    if [[ "$n" == "$cur"* ]]; then
      COMPREPLY+=("$(printf '%q' "$n")")
    fi
  done
}

_macmail_complete() {
  local cur prev words cword
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  words=("${COMP_WORDS[@]}")
  cword=$COMP_CWORD

  # If prev is a flag that takes a value, complete that value.
  case "$prev" in
    --account)
      _macmail_collect macmail accounts
      _macmail_reply_from_names
      return
      ;;
    --mailbox)
      # Look for --account NAME earlier on the line, fall back to env / default.
      local acct="${MACMAIL_DEFAULT_ACCOUNT:-}"
      local i
      for (( i=1; i < cword; i++ )); do
        if [[ "${words[i]}" == "--account" && $((i+1)) -lt $cword ]]; then
          acct="${words[i+1]}"
          break
        fi
      done
      _macmail_collect macmail mailboxes --filter "$acct"
      _macmail_reply_from_names
      return
      ;;
    --filter)
      # Free-form pattern; no useful completion.
      return
      ;;
    --in)
      COMPREPLY=( $(compgen -W "subject body both" -- "$cur") )
      return
      ;;
    --shell)
      COMPREPLY=( $(compgen -W "zsh bash" -- "$cur") )
      return
      ;;
    --max|--days|--since|--until|--sender|--to|--cc|--bcc|--subject|--body|--snippet)
      return
      ;;
  esac

  # Subcommand position.
  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "accounts mailboxes triage search read mark send reply completions help --help -h --version" -- "$cur") )
    return
  fi

  local sub="${words[1]}"
  local common="--account --mailbox --max --json"
  local writeflags="--dry-run --yes -y"
  local flags="$common"

  case "$sub" in
    accounts)
      flags="--json"
      ;;
    mailboxes)
      flags="--filter --json"
      ;;
    triage)
      flags="$common"
      ;;
    search)
      flags="$common --in --days --since --until --sender --to --unread --flagged --count-only --snippet --body"
      ;;
    read)
      # `read` doesn't honour --account/--mailbox; it locates by id.
      flags="--json --headers --html"
      ;;
    mark)
      if [[ $cword -eq 3 && "$cur" != -* ]]; then
        COMPREPLY=( $(compgen -W "read unread" -- "$cur") )
        return
      fi
      flags="$common $writeflags"
      ;;
    send)
      # send uses Mail.app's default account; --account/--mailbox don't apply.
      flags="$writeflags --to --subject --body --cc --bcc --draft"
      ;;
    reply)
      flags="$common $writeflags --body --all --draft"
      ;;
    completions)
      flags="--shell --install"
      ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
  fi
}

complete -F _macmail_complete macmail
