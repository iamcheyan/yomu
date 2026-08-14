#!/bin/bash
# 下载 Yomu 阅读器内置日文字体（SIL OFL 1.1）到 assets/fonts/。
#
# 决策：字体 woff2（每个约 1-1.9MB，共约 5.6MB）直接 git 入库——
# 低于 50MB 上限，且保证 Web PWA / Android APK 离线可用。
# 本脚本仅用于来源溯源 / 重新下载 / 升级版本。
set -e
cd "$(dirname "$0")/.."
mkdir -p assets/fonts/licenses

# @fontsource 固定版本（5.3.0），与 js/fonts.js 中的 cdn 兜底一致
declare -A FILES=(
  [noto-serif-jp]=noto-serif-jp-japanese-400-normal.woff2
  [noto-sans-jp]=noto-sans-jp-japanese-400-normal.woff2
  [klee-one]=klee-one-japanese-400-normal.woff2
  [zen-maru-gothic]=zen-maru-gothic-japanese-400-normal.woff2
)
# google/fonts 仓库内目录名（用于取 OFL.txt）
declare -A GFDIRS=(
  [noto-serif-jp]=notoserifjp
  [noto-sans-jp]=notosansjp
  [klee-one]=kleeone
  [zen-maru-gothic]=zenmarugothic
)

for name in "${!FILES[@]}"; do
  echo ">>> $name"
  curl -sL --fail -o "assets/fonts/${name}-400.woff2" \
    "https://cdn.jsdelivr.net/npm/@fontsource/${name}@5.3.0/files/${FILES[$name]}"
  curl -sL --fail -o "assets/fonts/licenses/OFL-${name}.txt" \
    "https://raw.githubusercontent.com/google/fonts/main/ofl/${GFDIRS[$name]}/OFL.txt"
done

echo "完成："
ls -la assets/fonts/*.woff2 assets/fonts/licenses/
