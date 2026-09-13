# Yomu Android 编译与真机推送流程

本文记录 Yomu 从当前 Web 代码编译 Android APK，并通过 USB 推送到 Android 阅读器/手机的完整流程。以后只需要修改 Web 代码、执行编译和安装即可，不需要手动复制网页资源。

## 1. 当前 Android 架构

- Android 包名：`com.yomu.app`
- Android 工程：`android/`
- 壳类型：Android WebView
- Web 资源来源：项目根目录的 `index.html`、`css/`、`js/`、`assets/`、`data/` 等
- APK 输出：`build_output/yomu-debug.apk`
- 最低 Android 版本：API 21
- 编译 SDK：API 33
- Build Tools：35.0.1
- Gradle Wrapper：8.5
- Android Gradle Plugin：8.2.2

`android/app/build.gradle` 中的 `syncWebAssets` 会在编译前自动清空并重新同步 `android/app/src/main/assets/`。因此，网页端的最新修改会自动进入 APK。

## 2. 编译前需要的环境

在项目根目录执行：

```bash
cd /home/tetsuya/development/yomu
java -version
adb version
adb devices
```

至少需要：

- JDK 17（Android Gradle Plugin 8.x 使用）
- Android SDK Platform 33
- Android SDK Build Tools 35.0.1
- Android Platform Tools（包含 `adb`）
- 可用的网络连接（首次编译需要 Gradle/依赖下载）

如果 `java` 或 `adb` 不存在，先在本机准备 Android 开发环境。不要把 SDK、JDK 的机器绝对路径写进项目；Gradle 和 ADB 应通过当前 shell 的 `PATH`、`JAVA_HOME`、`ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 找到它们。

检查 SDK 变量：

```bash
echo "$JAVA_HOME"
echo "$ANDROID_HOME"
echo "$ANDROID_SDK_ROOT"
```

如果手机显示为 `unauthorized`，解锁设备并在设备上确认“允许 USB 调试”。

## 3. 编译 APK

推荐使用项目自带的一键脚本：

```bash
cd /home/tetsuya/development/yomu
./build_apk.sh
```

脚本会依次：

1. 更新 `data/version.json`。
2. 进入 `android/`。
3. 执行 `./gradlew clean assembleDebug`。
4. 编译前自动同步最新 Web 资源。
5. 将 APK 复制到 `build_output/yomu-debug.apk`。
6. 输出 APK 体积、内置小说数量和资源大小。

编译完成后确认产物存在：

```bash
ls -lh build_output/yomu-debug.apk
```

也可以只在 Android 工程内编译，但不建议作为日常流程，因为需要自己处理 APK 拷贝：

```bash
cd android
./gradlew clean assembleDebug
```

产物位于：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 4. 连接设备并推送

先确认设备已经连接：

```bash
adb devices
```

正常结果应类似：

```text
List of devices attached
DAE0421D    device
```

然后执行：

```bash
./install_apk.sh build_output/yomu-debug.apk
```

安装脚本会：

1. 关闭 ADB 安装校验（失败也不会中断）。
2. 卸载旧的 `com.yomu.app`。
3. 安装新的 Debug APK。
4. 启动 Yomu。

成功时最后会显示：

```text
✅ Yomu 已成功部署并启动！
```

如果 APK 已经在 `build_output/`，也可以直接执行：

```bash
./install_apk.sh
```

## 5. 保留设备上的应用数据

当前 `install_apk.sh` 为了保证干净安装，会先卸载旧包。卸载会清除应用沙盒中的本地数据，包括阅读进度、书架和设置。

如果这次只是前端样式或逻辑调试，希望保留设备数据，可以手动覆盖安装：

```bash
adb install -r build_output/yomu-debug.apk
adb shell monkey -p com.yomu.app -c android.intent.category.LAUNCHER 1
```

只有遇到旧资源、旧 WebView 状态或安装异常时，才使用完整的 `./install_apk.sh` 干净重装。

## 6. 推送后的验证清单

启动后建议按下面顺序快速检查：

1. 首页能否正常进入本棚和青空文库全作品。
2. 本棚中的已下载书是否可以直接打开。
3. 全作品中的未下载书是否显示灰色虚线封面，点击后能下载。
4. 分类、作者、文字遣い、翻译、下载状态筛选是否正常。
5. 书籍封面是否保持 105:148 文库本比例，并正确显示进度、字数和封面状态。
6. 阅读正文、振假名、字体设置是否正常。
7. 在字体设置中切换正文/振假名字体：正文字体应同步影响网站标题和书籍封面；振假名字体只影响振假名。
8. 返回、重新打开应用后，阅读进度和设置是否保留。

可以用 ADB 确认应用是否正在运行：

```bash
adb shell pidof com.yomu.app
adb shell dumpsys activity activities | grep com.yomu.app
```

## 7. 当前已经进入 APK 的主要功能

- WebView 离线阅读器和 PWA 资源结构。
- 本棚 / 青空文库全作品统一入口。
- 云端书和本地书的两种视觉状态。
- 点击未下载封面下载到本地。
- 书籍封面统一设计：文库判比例、分类色边框、封底、翻页和不同阅读进度状态。
- 本棚显示阅读进度和作品字数。
- 全作品筛选：分类、作者、文字遣い、翻译状态、下载状态。
- 正文和振假名分别选择字体。
- 正文所选字体同步用于网站标题和书籍封面。
- 阅读器的护眼主题、字号、行距、页边距和沉浸阅读等设置。
- Android 编译前自动同步 Web 资源，避免手动复制测试页或样式。

## 8. 常见问题

### `JAVA_HOME is not set` 或找不到 Java

当前 shell 没有找到 JDK。检查：

```bash
which java
java -version
echo "$JAVA_HOME"
```

确保使用 JDK 17，并重新打开终端或设置正确的 `JAVA_HOME`。

### `adb: command not found`

Platform Tools 不在 `PATH`。确认 Android SDK 的 `platform-tools/adb` 存在，并把该目录加入当前 shell 的 `PATH`。

### `SDK location not found`

设置 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`，并确认 SDK 中安装了 API 33 和 Build Tools 35.0.1。

### 手机显示 `unauthorized` 或没有设备

检查 USB 线、USB 调试开关和设备上的授权弹窗，然后重新执行：

```bash
adb kill-server
adb start-server
adb devices
```

### 编译时提示 APK 内小说数量不一致

这是 `build_apk.sh` 对 `data/books.json` 和 Android 精选书目列表的检查警告，不一定会导致编译失败。先确认 APK 已成功生成；如果确实需要更新 APK 内置精选书目，再同步检查 `android/app/build.gradle` 的 `bundledBookIds`。

### 页面看起来还是旧版本

网页资源使用了版本查询参数，正常修改时应同步提高对应的 `?v=`；Android 完整重装后仍旧异常，可以清除应用数据或执行完整的 `./install_apk.sh`。

## 9. 最短日常流程

日常修改完成后，直接执行：

```bash
cd /home/tetsuya/development/yomu
./build_apk.sh
adb devices
./install_apk.sh build_output/yomu-debug.apk
```

如果要保留手机上的阅读数据，把最后一步替换为：

```bash
adb install -r build_output/yomu-debug.apk
adb shell monkey -p com.yomu.app -c android.intent.category.LAUNCHER 1
```
