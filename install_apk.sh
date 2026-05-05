#!/bin/bash
set -e

# Yomu APK 安装脚本
# 默认从远程编译服务器下载并安装最新 APK

REMOTE="tetsuya@192.168.3.62"
REMOTE_APK="/home/tetsuya/Development/yomu/build_output/yomu-debug.apk"
LOCAL_APK="$HOME/Downloads/yomu-debug.apk"

if [ -n "$1" ] && [ -f "$1" ]; then
    echo ">>> 使用指定的本地 APK: $1"
    APK="$1"
else
    echo ">>> 正在从远程服务器 ($REMOTE) 下载最新 APK..."
    if scp "$REMOTE:$REMOTE_APK" "$LOCAL_APK"; then
        APK="$LOCAL_APK"
    elif [ -f "build_output/yomu-debug.apk" ]; then
        echo ">>> 远程下载失败，尝试使用本地 build_output/ 下的 APK..."
        APK="build_output/yomu-debug.apk"
    else
        echo "❌ 错误: 无法从远程获取 APK，且本地未找到编译产物。"
        exit 1
    fi
fi

echo "--------------------------------------------------"
echo "📦 准备安装 APK: $APK"

# 识别包名 (com.yomu.app)
PKG="com.yomu.app"
echo "🆔 识别到包名: $PKG"

# 基础设置优化 (针对墨水屏等设备)
echo ">>> 优化 ADB 安装设置..."
adb shell settings put global verifier_verify_adb_installs 0 || true
adb shell settings put global package_verifier_enable 0 || true

# 卸载旧版本 (确保干净安装)
if adb shell pm list packages | grep -q "package:$PKG"; then
    echo ">>> 正在卸载旧版本..."
    adb uninstall "$PKG" || true
fi

echo ">>> 正在安装..."
adb install -r "$APK"

echo ">>> 正在启动应用..."
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1

echo "--------------------------------------------------"
echo "✅ Yomu 已成功部署并启动！"
