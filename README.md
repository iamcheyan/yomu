# Yomu

Yomu 是一个面向日语阅读学习的离线阅读工具。它以浏览器 Web App 为主体，也可以打包成 Android APK，在平板、手机和电脑上阅读日本公版文学作品。

在线预览：<https://yomu.iamcheyan.com>

## 特点

- 离线阅读：作品内容以本地 JSON 形式保存，加载后不依赖持续联网。
- 墨水屏优化：界面尽量减少动画和复杂色彩，阅读器使用高对比、低干扰的排版。
- 日语学习辅助：支持假名标注显示，并集成 Kuromoji 分词能力。
- 书库检索：可浏览和搜索青空文库来源的作品目录。
- Android 打包：可通过 Gradle 打包为 APK，适合部署到安卓墨水屏设备。

## 内容来源与版权说明

本项目收录和整理的作品主要来自青空文库（Aozora Bunko）公开提供的公版文学资源。感谢青空文库及其志愿者长期进行文本录入、校对、整理与公开发布工作。

当前仓库中：

- `data/novels/` 包含约 11000 本作品内容文件。
- `data/aozora_catalog.json` 包含约 15000 条青空文库作品目录记录。
- `data/books.json` 是应用首页展示的精选书目。

这些作品以公版或青空文库允许公开阅读的文本为基础。本项目不主张拥有原作品版权，也不有意侵犯任何作者、译者、出版社或权利方权益。如果你认为仓库中的某个内容存在版权或授权问题，请通过 GitHub issue 联系，我会尽快核查并移除或修正。

青空文库：<https://www.aozora.gr.jp/>

## 本地使用

这个项目是静态 Web 应用，可以直接用本地 HTTP 服务打开：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080/
```

也可以直接访问在线版本：

```text
https://yomu.iamcheyan.com
```

## Android APK

项目包含 Android WebView 包装工程，可以构建调试 APK：

```bash
./build_apk.sh
```

生成的 APK 会输出到：

```text
build_output/yomu-debug.apk
```

当前 APK 构建逻辑默认只打包精选书目，避免把完整书库全部塞进安装包导致体积过大。完整书库数据适合通过 Web 版本或后续同步逻辑使用。

## 项目结构

```text
index.html              Web App 入口
css/                    样式与墨水屏阅读优化
js/                     阅读器、书库、存储、分词等前端逻辑
data/books.json         首页精选书目
data/aozora_catalog.json 青空文库目录索引
data/novels/            本地作品内容
libs/                   Kuromoji 及词典资源
android/                Android WebView 工程
scripts/                目录同步、元数据整理等脚本
```

## 致谢

- 青空文库：提供大量日本公版文学文本与元数据。
- 青空文库志愿者：录入、校对和维护文本。
- Kuromoji：提供日语形态素分析能力。

Yomu 的目标是让这些公开文学资源在现代设备，尤其是墨水屏设备上更容易阅读和学习。
