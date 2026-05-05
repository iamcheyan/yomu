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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data", "novels")
ENV_FILE = os.path.join(ROOT_DIR, ".env")
CONFIG_FILE = os.path.join(ROOT_DIR, "config.json")

TRANSLATION_PROMPT = """你是精通日语文学的中文翻译家。将以下日语原文翻译成中文。

要求：
1. 保持原文的文学风格和语气
2. 使用自然流畅的现代中文
3. 对于古日语/文语体，翻译为通顺的现代中文，不要用文言文
4. 不要添加解释或注释，只输出翻译结果
5. 人名、地名保留原文汉字
6. 如果原文是对话，保持对话的口语感

原文：
{text}"""


def load_env(path):
    env = {}
    if not os.path.exists(path):
        print(f"警告: .env 文件不存在: {path}")
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
        print(f"警告: config.json 不存在: {path}")
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
        "max_tokens": 1000,
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
    """翻译一个段落"""
    prompt = TRANSLATION_PROMPT.format(text=text)
    result = call_provider(provider, prompt)
    if result:
        # 清理可能的引号包裹
        result = result.strip('"').strip('"').strip('"').strip()
    return result


def translate_book(book_id, providers):
    """翻译一本书"""
    filepath = os.path.join(DATA_DIR, f"{book_id}.json")
    if not os.path.exists(filepath):
        print(f"  文件不存在: {filepath}")
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
    print(f"  共 {total} 段")

    for provider in providers:
        provider_label = provider["label"]
        provider_id = provider["id"]
        print(f"  模型: {provider_label} ({provider['model']})")

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

            result = translate_paragraph(provider, para)
            if result:
                existing_translations[i].append({
                    "text": result,
                    "model": provider_id,
                })
                translated_count += 1
            else:
                print(f"    段落 {i+1} 翻译失败")

            # 限速：避免 API 过载
            time.sleep(0.5)

        print(f"    完成: 新增 {translated_count} 段, 跳过 {skipped_count} 段")

    # 保存
    book["translations"] = existing_translations
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(book, f, ensure_ascii=False, indent=2)

    print(f"  已保存: {filepath}")
    return True


def main():
    # 加载配置
    env = load_env(ENV_FILE)
    config = load_config(CONFIG_FILE)
    providers = resolve_providers(config, env)

    if not providers:
        print("错误: 没有找到可用的 API 配置。请检查 .env 和 config.json")
        sys.exit(1)

    print(f"找到 {len(providers)} 个 provider 配置")

    # 测试所有 provider
    print("\n测试 API 连通性...")
    available = []
    for p in providers:
        status = "✓" if test_provider(p) else "✗"
        print(f"  {status} {p['label']} ({p['model']})")
        if status == "✓":
            available.append(p)

    if not available:
        print("\n错误: 没有可用的 API 模型")
        sys.exit(1)

    print(f"\n可用模型: {len(available)} 个")

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
