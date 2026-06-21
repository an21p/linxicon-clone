#!/usr/bin/env bash
#
# run.sh — local runner for Linxicon.
#
# The app is two processes: the Vite frontend (:5173) and the embeddings
# API (:8787). Vite proxies /api -> :8787. If the API isn't running you
# get "Could not reach the word service." in the UI — so the default
# command starts BOTH.
#
# Usage:
#   ./run.sh            # start frontend + API together (http://localhost:5173)
#   ./run.sh dev        # same as above
#   ./run.sh web        # start ONLY the Vite frontend (:5173)
#   ./run.sh api        # start ONLY the embeddings API (:8787)
#   ./run.sh test       # run the test suite once
#   ./run.sh watch      # run the test suite in watch mode
#   ./run.sh check      # type-check (svelte-check + tsc)
#   ./run.sh build      # static production build to dist/
#   ./run.sh preview    # build, then serve the production build
#   ./run.sh all        # check + test, then start frontend + API
#
set -euo pipefail

cd "$(dirname "$0")"

# Make sure dependencies are present before doing anything.
if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (node_modules missing)…"
  npm install
fi

cmd="${1:-dev}"

# Start the API + frontend together; Ctrl-C tears both down.
start_both() {
  echo "==> Starting embeddings API on http://localhost:8787"
  npm run dev:api &
  local api_pid=$!
  trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
  echo "==> Starting frontend on http://localhost:5173 (open this one)"
  npm run dev
}

case "$cmd" in
  dev)
    start_both
    ;;
  web)
    echo "==> Starting ONLY the frontend on http://localhost:5173"
    exec npm run dev
    ;;
  api)
    echo "==> Starting ONLY the embeddings API on http://localhost:8787"
    exec npm run dev:api
    ;;
  test)
    echo "==> Running test suite"
    exec npm test
    ;;
  watch)
    echo "==> Running test suite (watch)"
    exec npm run test:watch
    ;;
  check)
    echo "==> Type-checking"
    exec npm run check
    ;;
  build)
    echo "==> Building static site to dist/"
    exec npm run build
    ;;
  preview)
    echo "==> Building, then serving production preview"
    exec npm run preview
    ;;
  all)
    echo "==> Type-check + tests, then frontend + API"
    npm run check
    npm test
    start_both
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo "Usage: ./run.sh [dev|web|api|test|watch|check|build|preview|all]" >&2
    exit 1
    ;;
esac
