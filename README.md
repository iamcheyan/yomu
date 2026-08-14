# Yomu

Yomu 是一个面向日语阅读学习的离线阅读工具。它以浏览器 Web App 为主体，也可以打包成 Android APK，在平板、手机和电脑上阅读日本公版文学作品。

在线预览：<https://yomu.iamcheyan.com>

## 特点

- 离线阅读：作品内容以本地 JSON 形式保存，加载后不依赖持续联网。
- 墨水屏优化：界面尽量减少动画和复杂色彩，阅读器使用高对比、低干扰的排版。
- 日语学习辅助：支持假名标注显示，并集成 Kuromoji 分词能力。
- 书库检索：可浏览和搜索青空文库来源的作品目录。
- 汉字/假名分别指定字体：通过 `unicode-range` 双 `@font-face` 分流，内置 4 款 OFL 日文字体，离线可用。

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

## 字体与许可证

阅读器支持**汉字与假名分别指定不同字体**（例如：汉字=明朝体、假名=圆体）。
实现方式是 `unicode-range` 双 `@font-face` 分流（`js/fonts.js`）：假名槽位
命中平假名/片假名/半角片假名区间，汉字槽位命中 CJK 统一表意区间，其余
字符沿 font-family 链回退。

### 入库决策

字体 woff2 二进制**直接 git 入库** `assets/fonts/`：四款合计约 5.6MB，
低于 50MB 上限，且保证 Web PWA 与 Android APK（构建时随 `assets/**`
打包）离线可用。`scripts/download_fonts.sh` 可复现下载（@fontsource
固定版本 5.3.0），懒加载与进度条由 `js/fonts.js` 处理。

### 字体清单（全部 SIL Open Font License 1.1）

| 字体 | 用途 | 许可证 | 版权 |
|---|---|---|---|
| Noto Serif JP | 明朝体（正文首选） | [OFL 1.1](assets/fonts/licenses/OFL-noto-serif-jp.txt) | © 2012 Google Inc. |
| Noto Sans JP | ゴシック体 | [OFL 1.1](assets/fonts/licenses/OFL-noto-sans-jp.txt) | © 2014-2021 Adobe |
| Klee One | 教科書体（毛笔感） | [OFL 1.1](assets/fonts/licenses/OFL-klee-one.txt) | © 2020 Fontworks |
| Zen Maru Gothic | 圆体 | [OFL 1.1](assets/fonts/licenses/OFL-zen-maru-gothic.txt) | © 2021 Zen Maru Gothic Project |

SIL OFL 1.1 允许随软件分发、嵌入与再分发字体二进制；保留各字体
Reserved Font Name，许可证原文见 `assets/fonts/licenses/`。
验收记录与截图见 `docs/font-audit/`。

## 项目结构

```text
index.html              Web App 入口
css/                    样式与墨水屏阅读优化
js/                     阅读器、书库、存储、分词、字体分流等前端逻辑
assets/fonts/           内置日文字体（woff2，OFL 1.1）与许可证
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
