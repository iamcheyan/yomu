#!/bin/bash
# Yomu 一键编译 + 远程 ADB 部署脚本

set -e

# 1. 确保在项目根目录
cd "$(dirname "$0")"

# 解析参数
SYNC_PARAM=$1
DO_SYNC=false

if [[ $SYNC_PARAM == sync:* ]]; then
    DO_SYNC=true
    SYNC_INFO=${SYNC_PARAM#sync:}
    USER_PASS=${SYNC_INFO%@*}
    REMOTE_HOST=${SYNC_INFO#*@}
    REMOTE_USER=${USER_PASS%:*}
    REMOTE_PASS=${USER_PASS#*:}
    echo ">>> 检测到同步需求: 用户=$REMOTE_USER, 主机=$REMOTE_HOST"
fi

echo ">>> 正在更新版本信息..."
./scripts/update-version.sh

echo ">>> 正在启动 Gradle 编译（自动同步 Web 资源）..."
cd android
./gradlew clean assembleDebug
cd ..

human_size() {
    if command -v numfmt >/dev/null 2>&1; then
        numfmt --to=iec --suffix=B --format="%.1f" "$1"
    else
        awk -v bytes="$1" 'BEGIN {
            split("B KiB MiB GiB", unit, " ");
            size = bytes;
            idx = 1;
            while (size >= 1024 && idx < 4) {
                size /= 1024;
                idx++;
            }
            printf "%.1f%s", size, unit[idx];
        }'
    fi
}

# 生成产物路径
APK_SRC="android/app/build/outputs/apk/debug/app-debug.apk"
APK_NAME="yomu-debug.apk"
APK_DST="./build_output/$APK_NAME"
mkdir -p build_output
cp "$APK_SRC" "$APK_DST"

APK_SIZE_BYTES=$(stat -c%s "$APK_DST")
ASSETS_SIZE=$(du -sh android/app/src/main/assets 2>/dev/null | awk '{print $1}')
NOVELS_DIR_SIZE=$(du -sh android/app/src/main/assets/data/novels 2>/dev/null | awk '{print $1}')
DICT_SIZE=$(du -sh android/app/src/main/assets/libs/dict 2>/dev/null | awk '{print $1}')
CATALOG_SIZE=$(du -ch android/app/src/main/assets/data/aozora_catalog_preview.json android/app/src/main/assets/data/aozora_catalog_compact.json 2>/dev/null | awk '/total$/ {print $1}')
NOVEL_COUNT="N/A"
NOVEL_RAW_SIZE="N/A"
EXPECTED_NOVEL_COUNT="N/A"

if command -v python3 >/dev/null 2>&1 && [ -f data/books.json ]; then
    EXPECTED_NOVEL_COUNT=$(python3 -c 'import json; print(len(json.load(open("data/books.json", encoding="utf-8"))))')
fi

if command -v unzip >/dev/null 2>&1; then
    read -r NOVEL_COUNT NOVEL_RAW_BYTES < <(
        unzip -l "$APK_DST" | awk '$4 ~ /^assets\/data\/novels\// { count++; size += $1 } END { print count + 0, size + 0 }'
    )
    NOVEL_RAW_SIZE=$(human_size "$NOVEL_RAW_BYTES")
fi

echo "--------------------------------------------------"
echo "✅ 编译成功！"
echo "📦 APK 体积: $(human_size "$APK_SIZE_BYTES")"
echo "📚 APK 内小说: $NOVEL_COUNT 个，原始大小 $NOVEL_RAW_SIZE（精选书目 $EXPECTED_NOVEL_COUNT 个）"
echo "🧩 assets 目录: ${ASSETS_SIZE:-N/A}（小说 ${NOVELS_DIR_SIZE:-N/A} / 词典 ${DICT_SIZE:-N/A} / 目录 ${CATALOG_SIZE:-N/A}）"

if [ "$EXPECTED_NOVEL_COUNT" != "N/A" ] && [ "$NOVEL_COUNT" != "N/A" ] && [ "$NOVEL_COUNT" != "$EXPECTED_NOVEL_COUNT" ]; then
    echo "⚠️ 警告: APK 内小说数量与 data/books.json 不一致，请检查 android/app/build.gradle 的资源同步配置。"
fi

if [ "$DO_SYNC" = true ]; then
    echo ">>> 正在远程推送到 $REMOTE_HOST ..."
    REMOTE_DIR="/Users/$REMOTE_USER/Downloads"
    REMOTE_PATH="$REMOTE_DIR/yomu-debug.apk"

    if ! command -v sshpass &> /dev/null; then
        echo "⚠️ 错误: 未找到 sshpass 命令，请先执行: sudo apt install sshpass"
        exit 1
    fi

    # 1. 拷贝 APK
    sshpass -p "$REMOTE_PASS" scp -o StrictHostKeyChecking=no "$APK_SRC" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"

    # 2. 远程卸载、安装、提权并启动
    echo ">>> 正在远程部署到手机..."
    sshpass -p "$REMOTE_PASS" ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "
        export PATH=\$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Users/$REMOTE_USER/Library/Android/sdk/platform-tools
        
        ADB_CMD=\"adb\"
        if [ -x /opt/homebrew/bin/adb ]; then ADB_CMD=/opt/homebrew/bin/adb; fi
        if [ -x /usr/local/bin/adb ]; then ADB_CMD=/usr/local/bin/adb; fi
        
        echo \"[1/4] 使用 ADB 指令: \$ADB_CMD\"
        
        echo \"[1/4] 关闭安装校验...\"
        \$ADB_CMD shell settings put global verifier_verify_adb_installs 0
        \$ADB_CMD shell settings put global package_verifier_enable 0
        
        echo \"[2/4] 正在卸载旧版本...\"
        \$ADB_CMD uninstall com.yomu.app || true
        
        echo \"[3/4] 正在安装新版本...\"
        \$ADB_CMD install -r $REMOTE_PATH
        
        echo \"[4/4] 正在启动 App...\"
        \$ADB_CMD shell monkey -p com.yomu.app -c android.intent.category.LAUNCHER 1
    "
    
    echo "🚀 全自动化部署完成！"
else
    FULL_PATH="$(pwd)/build_output/$APK_NAME"
    echo "--------------------------------------------------"
    echo "💡 提示: 最新的 APK 已保存在:"
    echo "   $FULL_PATH"
    echo "--------------------------------------------------"
fi
