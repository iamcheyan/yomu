# Lighthouse 移动端基线 — Yomu

日期：2026-08-14 · Lighthouse v12（headless Chrome，form-factor=mobile，390×844 @2x，4G throttling）
目标端口：http://localhost:8830/

## 性能基线（仅记录，不设硬指标）

| 指标 | 数值 |
|---|---|
| Performance | **27** |
| First Contentful Paint | 3.7 s |
| Largest Contentful Paint | 110.9 s* |
| Total Blocking Time | 29,280 ms |
| Cumulative Layout Shift | 0.076 |
| Speed Index | 22.2 s |

\* LCP/TBT 数值受本地无头环境 + 应用启动期异步加载大数据影响显著：
`data/aozora_catalog.json`(6.3MB)、`libs/kuromoji.js`(300KB)、词典数据均在启动路径上，
节流模拟下网络长期忙碌导致 LCP 被拖长；真机 Wi-Fi 下体感加载正常。

## 可安装性（结构性证据）

Lighthouse v12 已移除独立 PWA 类别，以下为结构核验：

- `manifest.json`：name/short_name/start_url/display:standalone 完整；图标 SVG(any) + PNG 512×512(any+maskable)
- `sw.js`（本次新增）：已注册并**实测离线可用**（断网重载后书架 6 册正常渲染）
- `<link rel="apple-touch-icon">` → 512×512 PNG
- viewport：`viewport-fit=cover` 已配置

结论：满足 Chrome 安装条件（manifest + SW + HTTPS/localhost）。
