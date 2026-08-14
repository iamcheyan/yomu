# data/dict/ — 按需词典数据

## 文件

- `jmdict.json` — 运行时按需载入的精简日汉…英词典（3.93MB，30,104 常用条目 / 66,507 索引键）。

## 数据来源

- **JMdict_e** — JMdict project, © Electronic Dictionary Research and
  Development Group (James Breen / EDRDG), 1991-2026.
  原始下载: <https://www.edrdg.org/pub/Nihongo/JMdict_e.gz>

## 许可证

- JMdict 按 **Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)**
  （EDRDG licence 的派生版）分发: <https://www.edrdg.org/edrdg/licence.html>
- 本仓库中的 `jmdict.json` 是其派生物（仅保留常用语条目、读音与前 3 条英文
  释义），分发时须保留本许可说明。上游条款同样要求 ShareAlike——若再分发
  本派生物，请保持 CC BY-SA 4.0 并注明 EDRDG/JMdict 来源。

## 构建

```bash
python3 scripts/build_dict.py             # 重新生成（默认常用语子集）
python3 scripts/build_dict.py --all       # 全量（约 218k 条目，体积更大）
python3 scripts/build_dict.py --limit 500 # 小样本（管线冒烟）
```

脚本从 EDRDG 官方地址下载当日 `JMdict_e.gz`（缓存在 `/tmp/yomu_JMdict_e.gz`），
流式解析后写出。生成时间、条目数、来源 URL 记录在 JSON 的 `meta` 字段内。

## 运行时

`js/dict.js`（YomuDict）在用户**首次点击词元**时才 fetch 本文件（首屏零开销）；
首次成功后由 `sw.js` 的 `data/` cache-first 策略缓存，离线可用。载入失败时
弹窗显示错误与「再試行」，不阻塞阅读器。
