#!/bin/bash
# Bid Workshop — 稳健版启动脚本
# 独立启动每个 watch 进程，避免 pnpm --parallel 的 SIGTERM 问题

set -e
cd "$(dirname "$0")"
REPO_ROOT="$(pwd)"

cleanup() {
    echo ""
    echo "Stopping all processes..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "==> Building shared packages (one-shot)..."
pnpm --dir "$REPO_ROOT" \
    --filter @bid-workshop/session-driver \
    --filter @bid-workshop/pi-sdk-driver \
    --filter @bid-workshop/catalogs \
    --filter @bid-workshop/extension-ui \
    run build

echo ""
echo "==> Starting watch processes independently..."

PIDS=()

# Start each watch process in its own pnpm invocation
pnpm --dir "$REPO_ROOT" --filter @bid-workshop/session-driver run build -- --watch &
PIDS+=($!)

pnpm --dir "$REPO_ROOT" --filter @bid-workshop/pi-sdk-driver run build -- --watch &
PIDS+=($!)

pnpm --dir "$REPO_ROOT" --filter @bid-workshop/catalogs run build -- --watch &
PIDS+=($!)

pnpm --dir "$REPO_ROOT" --filter @bid-workshop/extension-ui run watch &
PIDS+=($!)

# Give watch processes a moment to start
sleep 2

echo "==> Starting Electron dev server..."
cd apps/desktop
pnpm exec electron-vite dev --watch "$@" &
PIDS+=($!)

echo ""
echo "All processes started. Press Ctrl+C to stop."
echo "PIDs: ${PIDS[*]}"
echo ""

# Wait for any child to exit
wait -n "${PIDS[@]}" 2>/dev/null || true
echo ""
echo "A process exited. Stopping all..."
cleanup
