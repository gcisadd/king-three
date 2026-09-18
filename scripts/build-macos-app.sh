#!/bin/sh

set -eu

ARCH="${1:-arm64}"
PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
APP_BUNDLE="$PROJECT_ROOT/dist/ArmyTask.app"
TARGET="node24-macos-${ARCH}"

case "$ARCH" in
  arm64|x64)
    ;;
  *)
    echo "用法: $0 [arm64|x64]" >&2
    exit 1
    ;;
esac

rm -rf "$APP_BUNDLE"

mkdir -p \
  "$APP_BUNDLE/Contents/MacOS" \
  "$APP_BUNDLE/Contents/Resources"

clang \
  -arch "$ARCH" \
  -O2 \
  -framework Cocoa \
  -o "$APP_BUNDLE/Contents/MacOS/ArmyTask" \
  "$PROJECT_ROOT/macos/ArmyTaskLauncher.m"

npx --yes @yao-pkg/pkg \
  -t "$TARGET" \
  -o "$APP_BUNDLE/Contents/Resources/army-task-bin" \
  "$PROJECT_ROOT/army-task.js"

cp "$PROJECT_ROOT/macos/Info.plist" \
  "$APP_BUNDLE/Contents/Info.plist"

echo "已生成: $APP_BUNDLE"
echo "双击 ArmyTask.app 即可启动任务并自动打开看板。"
