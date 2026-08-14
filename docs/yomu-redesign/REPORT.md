# Yomu 视觉重构验收报告 — 无框 · 单页连续阅读 · 出版物体验

> 2026-08-14。基线 commit `c256d2d4`（仅含目标文档），本次重构改动
> `index.html` / `css/style.css` / `js/app.js` / `js/reader.js` / `sw.js` /
> 本目标文档（补充置顶约束）。

## 一、改动总览

| 文件 | 改动 |
| --- | --- |
| `index.html` | 编辑部式结构重写：app-bar、首页 hero/搜索/筛选 chips/统计/继续阅读栏/纵向列表、书库 hero/工具栏（筛选弹出面板 + 列表/网格图标切换）/排版式列表、阅读器单页连续流 + 浮动顶栏（返回/书名/目录/生词本/自动滚动/沉浸/设置）+ 底部仅百分比文字 + 顶部 2px 进度线。无 tap-zone、无左右箭头、无 vertical-reading/双栏开关。资产版本 `style.css?v=19`、`app.js?v=28`、`reader.js?v=16`；UI 图标全部 SVG，标签全部日文 |
| `css/style.css` | 全量重写（3207 行）：设计令牌（纸张 `#F7F3EA`/墨 `#282521`/次级 `#8D867C`/茶色强调 `#8C7A54`；深夜 `#141414`/`#D8D2C8`/暗金 `#B99C63`；米黄/绿护眼保留；发丝线 `rgba` .12–.14）。编辑部式行列表、无框 chips/胶囊、响应式（<600 单列、601–1199、≥1200 桌面双栏 + sticky 侧栏）。**无任何封面样式**（`.tcover`/`--cover-*`/`.skeleton-cover` 全部删除） |
| `js/reader.js` | 纵向单页化：删除 `_isVertical`/`_scrollContainer`/全部 `scrollLeft` 分支；window scroll 进度；`_pendingJump` 全文检索跳转；分块渲染 + IntersectionObserver；青空 ruby 注音与 NLP 后台注音队列保留 |
| `js/app.js` | 删除纵排/边缘点按/双栏/首页视口分页；新 `_renderBookList`（排版式行）、`_renderContinueRail`、`_renderHomeStats`、书库行/网格单元（纯文字栈）+ `setStoreViewMode`/`clearStoreFilters`、骨架屏、筛选计数徽标、`#store-sub` 数量行。**无任何封面生成代码**（`tcover` 生成已全部移除） |
| `sw.js` | 缓存名 `yomu-v15` → `yomu-v16`（外壳策略不变；`libs/dict/*` 经 SWR 分支按需入缓存，首次在线启动后即可离线冷启动，见 §四） |

## 二、封面禁令落实（用户置顶约束）

- `data/books.json` 与 `data/novels/*.json` 均无 cover 字段 → 全站零封面。
- DOM 实测：`.tcover` 元素 **0 个**（首页/书库/继续阅读/网格模式全检）。
- CSS 实测：`--cover-*`、`.tcover`、`.skeleton-cover` 规则 **0 条**。
- 书籍列表视觉主角 = 标题（明朝体 600）+ 作者（sans 次级色）+ 2px 进度线；
  「继续阅读」为纯排版单元（大标题 15.5px 双行截断 + 作者 + 进度）。

## 三、验收结果（全部实测，非推断）

### 1. 四视口 × 双主题 × 三表面（24 组合）

`document.documentElement.scrollWidth === clientWidth` 与 `body.scrollWidth === body.clientWidth`：

**24/24 通过，0 横向溢出。**（过程发现并修复一处：390px 下书库工具栏 13px 溢出——
`.store-search` 缺 `min-width:0`，flex 项目固有最小宽度顶出画布；补 `min-width:0`
后 390/390。该修复同时将 `style.css?v=18→19`、SW 缓存 `v15→v16` 以便客户端取新外壳。）

截图 24 张：`docs/yomu-redesign/screens/{home,store,reader}-{390,768,1280,1920}-{light,dark}.webp`

### 2. Console 零错误

全部验证会话（含阅读、下载、跳章、筛选、离线冷启动）挂接 `console`/`pageerror`
采集器：**0 error**。

### 3. 阅读器单页连续性

- `vertical-reading` class：不存在；`#vertical-reading-toggle`/`#two-column-toggle`/`#edge-tap-toggle`：DOM 中不存在。
- `.tap-zone` / 左右箭头按钮：**0 个**。
- 进度基于 `scrollTop`：滚至 3000px → 底栏 `12%`、顶部进度线同步。
- 分块渲染 + 滚动触发；章跳转 `jumpToChapter(3)` → `scrollY 13201`。
- 桌面正文 720px 居中；手机左右 24px；正文 21px / 行高 2.1（令牌默认）。

### 4. 功能不回归（逐项实测）

| 功能 | 结果 |
| --- | --- |
| 首页渲染 | 22 行（20 精选 + 2 下载），筛选 chips 4 个 |
| 打开书籍 / 进度恢复 | ✓（重开回位；继续阅读栏出现 羅生門 条目） |
| 目录 | 46 项渲染、当前章高亮、跳转滚动 ✓（羅生門无章节数据 → 目录空为数据本身如此，非回归） |
| 青空注音 internal | 33 个 `<ruby>`（例「雷光らいこう」） |
| NLP 注音 nlp | 后台队列产出 ruby（例「ねずみ色」），词典就绪 |
| AI 翻译 | `runAiOnParagraph` 存在、设置面板 provider/BaseURL/Model/Key 配置区完整 |
| 生词本 | 添加「超人間」→ 列表 1 条；阅读器顶栏按钮 → 面板开/关、条目渲染 |
| 自动滚动 | 启动 1.5s 滚动 71px，再点停止 |
| 沉浸模式 | `reader-immersive` 开/关 ✓ |
| 中央点按呼出 | 顶栏 opacity 0→1，5s 自动隐藏 |
| 字号/行距 | `setFontSize(24)` → 段落 computed `24px`（恢复 21） |
| 四档背景 + 深夜主题 | 米黄/绿/纸/深夜 computed bg 逐一切换 ✓ |
| 书库 | 目录 15,035 条、搜索「羅生門」命中、筛选弹出面板（作者/分类 chips）、列表↔网格切换、分页 10/页 |
| 下载 | `2719_ruby_6135` 下载 → 直接开读；书架 22 行含下载书；`dl-dot` 已下载标记、`新着` badge |
| 长按菜单 | action-sheet 打开，含 AI 翻訳等动作 |
| 导入 | `.import-btn` → `Yomu.pickLocalFile()`（.txt/.epub） |
| 统计 | 首页统计盒「連続 1 日 · 累計 1 分 読了 94,400 字」 |
| 下拉刷新 | touch 拉拽 armed → `_refreshCurrentList()` + toast |
| 路由 | `#book/2719_ruby_6135` → 返回 → `#library` 首页激活 |
| PWA 离线 | offline reload：overlay 消失、首页 22 行、继续阅读 2 条、开书 50 段；缓存仅 `yomu-v16`（v15 已清除） |

### 5. 静态检查

- `node --check`：`js/app.js`、`js/reader.js`、`js/tokenizer.js`、`js/storage.js`、
  `js/fonts.js`、`js/aozora.js`、`js/wordbook.js`、`js/bookmarks.js`、`js/stats.js`、
  `js/importer.js`、`js/dict.js` 全部通过。
- `css/style.css` 花括号配平（opens == closes）。
- `git diff --check`：无空白错误。

## 四、过程发现的问题与修复

1. **`_renderBookList` 循环丢失**（本会话自查发现的重写事故）：编辑时误删
   `for (const book of filtered)` 循环导致首页 0 行。已恢复并实测 22 行。
2. **390px 书库工具栏溢出 13px**：`.store-search` 无 `min-width:0`。已修复；为让
   SW 客户端拿到新外壳，`style.css` 版本 v18→v19、SW 缓存 v15→v16。
3. **离线冷启动挂起（遗留问题，非本次引入）**：`libs/dict/*`（18MB，12 文件）
   不在 SW 预缓存列表；旧缓存 `yomu-v15` 时代首次离线启动会在 kuromoji 词典加载处
   挂起。验证结论：SWR 分支会在首次在线启动时把 12 个词典文件按需写入 `yomu-v16`
   缓存（实测缓存键含全部 12 个 `.dat.gz`），此后离线冷启动/开书/首页全部正常
   （overlay 消失、22 行、50 段）。预缓存 18MB 不符合移动端体量，故维持按需缓存，
   此为有意取舍。
4. 羅生門等 11041 本打包小说均为扁平 `paragraphs`（无 `chapters` 字段），
   目录依赖段内 `［＃…見出し］` 标记解析——与重构前行为一致。

## 五、Slop 审计（编辑部式设计 / japanese-editorial-reader-ui）

对全部内容表面做 DOM computed-style 扫描 + CSS 全文扫描：

| 检查项 | 计数 | 结论 |
| --- | --- | --- |
| 卡片墙（统一边框+底色+圆角+阴影的内容网格） | **0** | 书籍行为排版式行（发丝线分隔）；书库网格单元 computed：`border 0px`、无阴影、透明底 —— 纯文字栈 |
| 粗黑规则线（内容表面 border ≥3px） | **0**（CSS 全文唯一 ≥3px border 为设置面板 range 滑块 thumb 的 3px 白描边——表单控件功能件，非装饰线条） | ✓ |
| box-shadow | 11 处 CSS 定义，DOM 命中 3 处，全部为浮动 chrome（顶栏浮层、弹出面板、模态）的 `--shadow-pop` 低强度投影 | 浮动层需高度暗示，非卡片墙；内容表面 0 阴影 |
| 居中堆栈（SaaS hero 居中式） | **0 处滥用**：`.store-hero`/`.app-bar-inner` 均 `text-align:start`（左对齐）。存在的 center 共 6 类，全部正当：空状态文案、徽标计数文字、`.reader-masthead`（书籍扉页——出版物扉页本应居中，注释已言明「書籍の扉に倣う中央構図」）、`.bar-title`（顶栏书名居中）、`章見出し`（日本书籍章标题居中惯例）、模态正文 | ✓ |
| 封面占位/灰框/假封面 | **0**（DOM+CSS 双检） | ✓ |
| emoji 图标 | **0**（全部按钮 SVG；扫描 Unicode emoji 区段） | ✓ |
| 错误表面（书架用了目录排版/目录用了书架排版/阅读器用 chrome 打断正文） | **0**：书架=纵向行列表+继续阅读横栏；书库=目录浏览器（数量行+筛选弹出+列表/网格）；阅读器=连续文档 + 隐藏 chrome | ✓ |
| 常驻文字按钮堆砌 | 0：工具栏全部图标按钮（aria-label 日文），底部仅百分比文字 | ✓ |

## 六、结论

验收标准（四视口截图、亮暗双主题、`scrollWidth===clientWidth`、无纵排/翻页入口、
console 零错误、`git diff --check`、静态 JS 检查、PWA 离线回归）**全部通过**。
功能清单 22 项逐项实测无回归。封面禁令按用户置顶约束完整落实（DOM/CSS 双零）。
