# 字体系统验收记录（2026-08-14）

无头 Chromium（ :8830 本地服务）逐项验证，对应 FONT_SYSTEM_GOAL.md 第四节验收标准。

## 验收 1 — 设置面板（双下拉 + 预览）

`font_panel_mixed.png`：「フォント」区含三个预设按钮、漢字/かな双下拉、
各下拉下 12px 预览字「永遠の約束 かな カナ 123」、组合预览段
「吾輩は猫である。名字 123 ABC」。

## 验收 2 — 混排分流证明（unicode-range 生效）

`font_reader_mixed.png`：漢字=Noto Serif JP（明朝）+ かな=Zen Maru Gothic（圆体）。

Canvas 像素级证明（比肉眼截图更严格）：

| 测试 | 内容 | 像素差 |
|---|---|---|
| T1 | 假名串在「かな=圆体」vs「かな=明朝」下渲染 | 6716 px |
| T2 | **汉字串在两种假名字体下渲染（应完全一致）** | **0 px** |
| T3 | 汉字串在「漢字=明朝」vs「漢字=ゴシック」下渲染 | 5516 px |

T2=0 证明假名字体不影响汉字 → 分流生效，而非整体替换字体。

## 验收 3 — 切换即时生效 + 刷新保留

- UI 处理器 `Yomu.onFontSelect()` 即时改 `--reader-font-family`，不重载页面。
- reload 后 `yomu_settings.fontKanji/fontKana` 保留、`YomuFonts.current` 恢复、
  `document.fonts.check()` 双 true。

## 验收 4 — 断网后已缓存字体仍显示

`offline_cached_fonts.png`：请求拦截（woff2/CDN 全部 404，
`fetch(cdn)→Failed to fetch` 证明真断网）下 reload，SW 缓存命中的字体
照常渲染，与在线截图逐像素 diff = **0**。
（同时验证：清空 SW 字体缓存 + 断网时优雅降级为系统字体，正文可读不报错。）

## 验收 5 — 三预设截图

`preset_mincho.png` / `preset_textbook.png` / `preset_maru.png`；
两两像素 diff 29k~37k px，预设切换真实生效。

## 验收 6 — 入库决策与许可证

见 README「字体与许可证」：woff2 二进制直接入库（5.6MB < 50MB），
`assets/fonts/licenses/OFL-*.txt` 四份许可证原文，
`scripts/download_fonts.sh` 可复现下载（@fontsource 5.3.0 固定版本）。

## 字体覆盖度说明

四款字体均含约 6,900 字形（假名全、常用汉字全）。已知缺失：
半角片假名（U+FF61-FF9F 中 ｱｲｳ 等）与 U+2015（―），这些字符按
font-family 链自然回退系统字体，不影响阅读。
