# AGENTS.md — yomu 日语离线阅读器（智能体交接）

> 读者假设：你从未见过这个项目。~100 行讲清：架构/启动/近期改造/遗留。
>
> ⚠️ 本文件名暂为 AGENTS.staged.md：写入 AGENTS.md 需用户对"修改智能体指令文件"显式
> 同意（平台保护）。用户确认后 `git mv AGENTS.staged.md AGENTS.md` 即可，内容已定稿。

## 一、这是什么 / 架构

**yomu** = 面向日语阅读学习的**离线 Web App**（PWA）+ 可打包 Android APK（WebView 壳）。
在线版 https://yomu.iamcheyan.com （GitHub Pages，CNAME）。设计目标：**墨水屏优化**
（少动画/高对比/低干扰排版）。

- **纯静态站**：vanilla JS，无框架无构建。核心文件：
  - `index.html`（19K，单页应用壳）+ `css/`
  - `js/app.js`（书架/书库）、`js/reader.js`（阅读器主体）、`js/tokenizer.js`
    （Kuromoji 分词+假名标注）、`js/fonts.js`（字体系统）、`js/aozora.js`（青空文库目录）、
    `js/storage.js`（本地存储）
  - `data/novels/`（约 11000 本作品 JSON）、`data/aozora_catalog.json`（15000 条目录，
    6.3MB）、`data/books.json`（首页精选）、`assets/fonts/`（4 款 OFL 日文字体 woff2，
    git 入库 ~5.6MB）
  - `libs/kuromoji.js`（300KB 分词引擎）
- **AI 翻译提供方**配置在 `config.json`（zhipu/ark/mimo…，key 走环境变量名不落盘）。
- Android：`android/` WebView 壳工程 + `build_apk.sh`（只打包精选书目控体积）→
  `build_output/yomu-debug.apk`；`install_apk.sh` 安装。
- PWA：`manifest.json` + `sw.js`（应用壳 stale-while-revalidate、书数据 cache-first，
  实测离线可开书）。

## 二、启动 / 验证

```bash
cd ~/development/yomu
python3 -m http.server 8080            # 本地开发
# 82 服务器常驻实例（手机访问用）:
python3 -m http.server 8830 --bind 0.0.0.0    # http://<主机>:8830/

./build_apk.sh                          # Android 调试 APK
```

推送：origin = https://github.com/iamcheyan/yomu.git（main → GitHub Pages 自动发布）。
commit 信息用中文。

## 三、2026-08-14 改造清单（今天两轮 goal 的成果，commit 链可见）

1. **移动端深度优化**（81ac88a3）：
   - 阅读器：页边距/四档护眼底色（白/米黄/绿/黑）/亮度调节（localStorage 持久化）；
     沉浸模式（隐藏 chrome 点中央呼出）；顶部细进度条+回到顶部；屏幕边缘点按翻页；
     overscroll-behavior 防误触。
   - 书架：下拉刷新、搜索框 sticky、书卡长按菜单、下载非阻塞 toast+「新着」角标、
     触控目标 ≥44px。
   - PWA：viewport-fit=cover + safe-area 全覆盖、100dvh 降级、新增 sw.js、512 图标。
   - 修复：误删的 tokenizer.js 引用还原；assets 版本号提升。
2. **字体系统**（aac166d1，goal 019ffe60）：
   - **汉字/假名分别指定字体**（如 汉字=明朝体、假名=圆体）：`js/fonts.js` 用
     **同名双 @font-face + unicode-range 分流**（假名槽 U+3040-30FF/31F0-31FF/FF66-FF9D，
     汉字槽 CJK 统一表意区），其余沿 font-family 链回退。
   - 内置 4 款 OF 字体（Noto Serif JP/Noto Sans JP/Klee One/Zen Maru Gothic，许可证
     文件在 `assets/fonts/licenses/`）；懒加载+进度条；`scripts/download_fonts.sh` 可
     复现下载（@fontsource 固定版本 5.3.0）。
3. 深度审计文档在 `Mir3-Research/review_goals/`（REVIEW_GOAL 系）与本仓库
   `docs/`（font-audit/、mobile-audit/ 含 Lighthouse 基线）。

## 四、已知遗留 / 注意

- **Android 真机未验证**：今天的移动端+字体改造只做了浏览器（含 390x844 无头）验证，
  APK 未在真机回归——改 Android 相关逻辑前先装一次 `build_output/yomu-debug.apk` 确认
  基线。已知历史坑：双安卓壳+陈旧 APK 误装导致图标丢失（miyako 项目同款问题）。
- Lighthouse 移动端 Performance 仅 27（`docs/mobile-audit/LIGHTHOUSE.md`）——主因
  启动路径上 6.3MB 目录 JSON + 300KB kuromoji，**仅记录未设硬指标**，别盲目"优化"。
- 数据版权：作品来自青空文库公版资源，版权说明在 README §内容来源——**别往仓库加
  非公版内容**。
- `scratch/` 是一次性脚本堆（clean_css.py 等），不是产品代码。
