#!/usr/bin/env bash
# Fetches real-world q code (pinned commits) into .corpus/ for the KDB-X oracle tests.
# Not committed: kdb-tick ships without a license file.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/.corpus"
fetch() { # name url commit
  local dir="$dest/$1"
  [ -d "$dir/.git" ] && return
  git init -q "$dir"
  git -C "$dir" fetch -q --depth 1 "$2" "$3"
  git -C "$dir" checkout -q FETCH_HEAD
}
fetch kdb-tick https://github.com/KxSystems/kdb-tick 85c08ff192b0a103b323246c7300a37919be6159
fetch kx-vscode https://github.com/KxSystems/kx-vscode 2f9802c6cee2f614cc898158b6334922ac342f42
find "$dest" -name '*.q' -not -path '*/.git/*' -not -path '*/node_modules/*' | sort
