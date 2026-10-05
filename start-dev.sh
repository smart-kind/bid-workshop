#!/bin/bash
# Bid Workshop 开发启动脚本
cd "$(dirname "$0")"
echo "Building shared packages..."
pnpm run build:shared
echo ""
echo "Starting Bid Workshop desktop app..."
echo "Press Ctrl+C to stop"
echo ""
cd apps/desktop
pnpm dev
