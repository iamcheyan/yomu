#!/bin/bash
set -e

# Yomu APK 安装脚本
# 支持直接安装本地 APK 或从远程编译机下载安装

REMOTE="tetsuya@192.168.3.62"
REMOTE_APK="/home/tetsuya/Development/yomu/build_output/yomu-debug.apk"
LOCAL_APK="$HOME/Downloads/yomu-debug.apk"

if [ -n "$1" ] && [ -f "$1" ]; then
    APK="$1"
else
    if [ -f "build_output/yomu-debug.apk" ]; then
        echo ">>> 检测到本地 build_output/ 下有 APK，准备安装..."
        APK="build_output/yomu-debug.apk"
    else
        echo ">>> 正在从远程服务器下载最新 APK..."
        scp "$REMOTE:$REMOTE_APK" "$LOCAL_APK"
        APK="$LOCAL_APK"
    fi
fi

echo "--------------------------------------------------"
echo "📦 准备安装 APK: $APK"

# 尝试自动检测包名
PKG=$(python3 -c "
import zipfile, sys
try:
    with zipfile.ZipFile(sys.argv[1]) as z:
        data = z.read('AndroidManifest.xml')
        # 寻找 com.yomu.app 或类似的包名字符串
        # 针对 AXML 编码的简易搜索
        for i in range(len(data)-10):
            if data[i:i+4] == b'com.':
                s = data[i:i+30].decode('utf-8', errors='ignore').split('\x00')[0]
                if 'com.yomu.app' in s:
                    print('com.yomu.app'); sys.exit(0)
except: pass
print('com.yomu.app') # 默认回退
" "$APK")

echo "🆔 识别到包名: $PKG"

# 基础设置优化 (针对墨水屏等设备)
echo ">>> 优化 ADB 安装设置..."
adb shell settings put global verifier_verify_adb_installs 0 || true
adb shell settings put global package_verifier_enable 0 || true

# 卸载旧版本 (可选，-r 通常足够，但彻底清理更稳)
if adb shell pm list packages | grep -q "package:$PKG"; then
    echo ">>> 正在卸载旧版本以确保干净安装..."
    adb uninstall "$PKG" || true
fi

echo ">>> 正在安装..."
adb install -r "$APK"

echo ">>> 正在启动应用..."
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1

echo "--------------------------------------------------"
echo "✅ Yomu 已成功部署并启动！"
