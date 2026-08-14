# Yomu 字体系统（汉字/假名分别指定 + 开源日文字体包）— 完整任务目标

## 一、需求

阅读器加换字体功能。核心：**汉字和假名可以分别指定不同字体**（如 汉字=明朝体、
假名=圆体），用开源日文字体，直接下载并缓存到本地，离线可用。

## 二、字体包（全部 OFL/开源许可证）

候选按用途：
- **Noto Serif JP**（衬线，正文首选）/ **Noto Sans JP**（无衬线）
- **UD デジタル 教科書体 N-R**（教科书体，毛笔感适合电子书）
- **源ノ明朝 / 源ノ角ゴシック**（Source Han Serif/Sans JP）
- 圆体系（あんずもじ 等，可选一个）

下载策略：
- CDN 直链（jsdelivr 的 @fontsource 系或 Google Fonts static）→ 存
  `assets/fonts/`（或 data/fonts/，按仓库结构定）→ **git 入库**（单字体 woff2
  子集化后 1-5MB 可接受；若超 50MB 总量则只入库下载脚本+清单，二进制运行时下载）
- @font-face 动态注册；**懒加载**：用户选了才下载+缓存，显示下载进度条
- localStorage 记用户选择；离线（Android APP）已缓存字体直接用

## 三、分别指定的实现（关键技术：unicode-range 分流）

CSS font-family 无法按字符类型选字体——用**同名双 @font-face + unicode-range**：

```css
/* 假名字体注册: 平假名+片假名+半角片假名+长音 */
@font-face { font-family: "YomuKana"; src: url(...woff2); unicode-range: U+3040-30FF, U+31F0-31FF, U+FF66-FF9D; }
/* 汉字字体注册: CJK 统一表意 + 扩展A + 兼容 */
@font-face { font-family: "YomuKanji"; src: url(...woff2); unicode-range: U+4E00-9FFF, U+3400-4DBF, U+F900-FAFF; }
/* 正文 = 假名在前汉字在后(假名专属 range 命中假名字体,其余落汉字),拉丁/标点可再挂第三个 */
.reader-content { font-family: "YomuKana", "YomuKanji", sans-serif; }
```

设置面板「字体」区：
- **汉字字体**下拉 + **假名字体**下拉（各自带 12px 预览字「永遠の約束 かな カナ 123」）
- 实时组合预览段：「吾輩は猫である。名字 123 ABC」
- 三个预设一键切换：明朝经典（源ノ明朝×2）/ 教科书柔和（UD 教科書体 + Noto Sans）/ 圆体轻松
- 与现有字号/行距设置并列，即时生效不重载页面

## 四、验收

1. 字体设置面板截图（双下拉+预览）
2. **混排效果证明**：汉字=明朝体 + 假名=圆体 的截图（两种字形肉眼可辨差异，
   证明 unicode-range 分流生效而非整体一个字体）
3. 切换字体即时生效；刷新页面选择保留
4. 断网（或清 CDN 不可达）后已缓存字体仍正常显示
5. 三预设各一张效果截图
6. 字体二进制或下载脚本的入库决策写进 README（含许可证清单）
7. commit+push（中文）；:8830 服务重启后手机可验证

## 五、边界

- 不动上午已完成的功能（列表/搜索/目录/移动端优化）
- Android WebView 的 unicode-range 支持需验证（WebView 37+ 都支持，但用
  无头 chromium 截图证明分流生效即可）
- 端口/目录沿用现状（yomu 仓库 + :8830 服务）
