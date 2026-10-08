#!/usr/bin/env bash
# Copies the q parser used by the official KX VS Code extension's language server
# (https://github.com/KxSystems/kx-vscode, Apache-2.0) into vendor/kx-parser.
# Files are copied unmodified; bump KX_COMMIT to update.
set -euo pipefail
KX_COMMIT="${KX_COMMIT:-2f9802c6cee2f614cc898158b6334922ac342f42}"
FILES=(source lexer keywords literals ranges tokens)

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q
git -C "$tmp" remote add origin https://github.com/KxSystems/kx-vscode
git -C "$tmp" fetch -q --depth 1 origin "$KX_COMMIT"
git -C "$tmp" checkout -q FETCH_HEAD

dest="$root/vendor/kx-parser"
rm -rf "$dest"
mkdir -p "$dest"
for f in "${FILES[@]}"; do cp "$tmp/server/src/parser/$f.ts" "$dest/"; done
cp "$tmp/LICENSE" "$dest/LICENSE"
echo "$KX_COMMIT" > "$dest/COMMIT"
echo "vendored kx-vscode parser @ $KX_COMMIT -> vendor/kx-parser"
