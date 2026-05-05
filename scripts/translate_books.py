#!/usr/bin/env python3
"""
翻译脚本：使用多个 AI 模型翻译小说段落
用法：python3 scripts/translate_books.py [book_id ...]
不传参数则翻译所有书籍
"""
import json
import os
import sys
import urllib.request
import urllib.error
import time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data", "novels")
LOG_DIR = os.path.join(ROOT_DIR, "logs")
ENV_FILE = os.path.join(ROOT_DIR, ".env")
CONFIG_FILE = os.path.join(ROOT_DIR, "config.json")


class Logger:
    """同时输出到终端和日志文件"""
    def __init__(self):
        os.makedirs(LOG_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.log_path = os.path.join(LOG_DIR, f"translate_{timestamp}.log")
        self._file = open(self.log_path, "w", encoding="utf-8")
        print(f"日志文件: {self.log_path}")

    def log(self, msg):
        print(msg)
        self._file.write(msg + "\n")
        self._file.flush()

    def close(self):
        self._file.close()


logger = Logger()

TRANSLATION_PROMPT = """你是一位精通日语的中文翻译老师，正在帮助日语初学者阅读日本文学名著。

请将以下日语原文翻译成中文，并附带简要的语法解说。

要求：
1. 忠实还原原文含义，不遗漏、不添加、不意译
2. 保持原文的文学风格和语气
3. 使用自然流畅的现代中文
4. 对于古日语/文语体，翻译为通顺的现代中文，不要用文言文
5. 人名、地名保留原文汉字
6. 如果原文是对话，保持对话的口语感

翻译完成后，另起一行写「语法解说：」，用简明中文解释这段中对初学者有帮助的语法要点，例如：
- 重要的助词用法（は、が、を、に、で等）
- 动词变形（て形、た形、ない形、敬语等）
- 句型结构（～ている、～たことがある、～ように等）
- 古日语/文语体与现代日语的对照

语法解说要简洁，只挑这段中最重要的 1-3 个点，不要逐词翻译。如果这段没有特别值得讲解的语法，可以省略语法解说部分。

原文：
{text}"""


def load_env(path):
    env = {}
    if not os.path.exists(path):
        logger.log(f"警告: .env 文件不存在: {path}")
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, value = line.split('=', 1)
                env[key.strip()] = value.strip()
    return env


def load_config(path):
    if not os.path.exists(path):
        logger.log(f"警告: config.json 不存在: {path}")
        return {"providers": {}}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_providers(config, env):
    """解析所有可用的 provider 配置"""
    providers = []
    for pid, pc in config.get("providers", {}).items():
        if pc.get("enabled") is False:
            continue

        api_key = env.get(pc.get("api_key_env", ""), "")
        base_url = env.get(pc.get("base_url_env", ""), "")
        if not api_key or not base_url:
            continue

        # 支持多 key
        api_keys_env = pc.get("api_key_envs", [])
        api_keys = [env[k] for k in api_keys_env if env.get(k)]
        if not api_keys:
            api_keys = [api_key]

        model = env.get(pc.get("model_env", ""), pc.get("model", ""))
        fmt = pc.get("format", "openai")

        providers.append({
            "id": pid,
            "label": pc.get("label", pid),
            "api_key": api_keys[0],
            "api_keys": api_keys,
            "base_url": base_url,
            "model": model,
            "format": fmt,
        })
    return providers


def call_openai_compatible(api_key, base_url, model, prompt, timeout=120):
    """调用 OpenAI 兼容 API"""
    url = base_url.rstrip("/")
    if not url.endswith("/chat/completions"):
        url += "/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    data = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 2000,
        "temperature": 0.3,
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        return result["choices"][0]["message"]["content"].strip()


def call_gemini(api_key, base_url, model, prompt, timeout=120):
    """调用 Gemini REST API"""
    url = f"{base_url.rstrip('/')}/models/{model}:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    data = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}]
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        return result["candidates"][0]["content"]["parts"][0]["text"].strip()


def call_provider(provider, prompt):
    """统一调用入口"""
    fmt = provider["format"]
    try:
        if fmt == "gemini":
            return call_gemini(provider["api_key"], provider["base_url"], provider["model"], prompt)
        else:
            return call_openai_compatible(provider["api_key"], provider["base_url"], provider["model"], prompt)
    except Exception as e:
        return None


def test_provider(provider):
    """测试 provider 是否可用"""
    result = call_provider(provider, "你好，请用一句话回复。")
    if result and len(result) > 0:
        return True
    return False


def translate_paragraph(provider, text):
    """翻译一个段落，返回 (translation, grammar) 元组"""
    prompt = TRANSLATION_PROMPT.format(text=text)

    # 截断显示，避免日志过长
    display_text = text[:80] + ("..." if len(text) > 80 else "")
    logger.log(f"    >> 原文: {display_text}")

    result = call_provider(provider, prompt)
    if not result:
        logger.log(f"    << 失败: 无返回")
        return None, None

    display_result = result[:120] + ("..." if len(result) > 120 else "")
    logger.log(f"    << 回复: {display_result}")

    # 清理可能的引号包裹
    result = result.strip('"').strip('"').strip('"').strip()

    # 分离翻译和语法解说
    grammar = ""
    # 尝试多种分隔方式
    for sep in ["语法解说：", "语法解说:", "【语法解说】", "语法要点："]:
        if sep in result:
            parts = result.split(sep, 1)
            translation = parts[0].strip()
            grammar = parts[1].strip()
            # 去掉末尾可能的引号
            grammar = grammar.strip('"').strip('"').strip('"').strip()
            return translation, grammar

    return result, ""


def translate_book(book_id, providers):
    """翻译一本书"""
    filepath = os.path.join(DATA_DIR, f"{book_id}.json")
    if not os.path.exists(filepath):
        logger.log(f"  文件不存在: {filepath}")
        return False

    with open(filepath, "r", encoding="utf-8") as f:
        book = json.load(f)

    paragraphs = book.get("paragraphs", [])
    existing_translations = book.get("translations", [])

    # 初始化 translations 结构：每个段落一个数组
    if not isinstance(existing_translations, list):
        existing_translations = []
    # 确保长度匹配
    while len(existing_translations) < len(paragraphs):
        existing_translations.append([])

    total = len(paragraphs)
    logger.log(f"  共 {total} 段")

    for provider in providers:
        provider_label = provider["label"]
        provider_id = provider["id"]
        logger.log(f"  模型: {provider_label} ({provider['model']})")

        translated_count = 0
        skipped_count = 0

        for i, para in enumerate(paragraphs):
            # 跳过已有该模型翻译的段落
            existing = existing_translations[i]
            if any(t.get("model") == provider_id for t in existing):
                skipped_count += 1
                continue

            # 跳过太短的段落（标点、空白等）
            if len(para.strip()) < 3:
                continue

            translation, grammar = translate_paragraph(provider, para)
            if translation:
                entry = {
                    "text": translation,
                    "model": provider_id,
                }
                if grammar:
                    entry["grammar"] = grammar
                existing_translations[i].append(entry)
                translated_count += 1

                # 每翻译一段就保存，防止中断丢失
                book["translations"] = existing_translations
                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(book, f, ensure_ascii=False, indent=2)
            else:
                logger.log(f"    段落 {i+1} 翻译失败")

            # 限速：避免 API 过载
            time.sleep(0.5)

        logger.log(f"    完成: 新增 {translated_count} 段, 跳过 {skipped_count} 段")

    logger.log(f"  已保存: {filepath}")
    return True


def main():
    # 加载配置
    env = load_env(ENV_FILE)
    config = load_config(CONFIG_FILE)
    providers = resolve_providers(config, env)

    if not providers:
        logger.log("错误: 没有找到可用的 API 配置。请检查 .env 和 config.json")
        sys.exit(1)

    logger.log(f"找到 {len(providers)} 个 provider 配置")

    # 测试所有 provider
    logger.log("\n测试 API 连通性...")
    available = []
    for p in providers:
        status = "✓" if test_provider(p) else "✗"
        logger.log(f"  {status} {p['label']} ({p['model']})")
        if status == "✓":
            available.append(p)

    if not available:
        logger.log("\n错误: 没有可用的 API 模型")
        sys.exit(1)

    logger.log(f"\n可用模型: {len(available)} 个")

    # 确定要翻译的书
    if len(sys.argv) > 1:
        book_ids = sys.argv[1:]
    else:
        # 翻译所有已有书籍
        book_ids = []
        for f in os.listdir(DATA_DIR):
            if f.endswith(".json"):
                book_ids.append(f.replace(".json", ""))

    print(f"\n待翻译书籍: {len(book_ids)} 本")
    print("=" * 50)

    for book_id in book_ids:
        print(f"\n翻译: {book_id}")
        translate_book(book_id, available)

    print("\n全部完成!")


if __name__ == "__main__":
    main()
