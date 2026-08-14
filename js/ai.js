/**
 * YomuAI — C6: AI 段落翻訳/文法解説（provider 抽象 + 用户自带 key）
 *
 * 边界（必须遵守）:
 *  - 仓库/APK 内不写死任何 API key。key 仅由用户在设置界面输入，
 *    保存在本设备 localStorage（key: 'ai_config'），且不随 C5 备份导出。
 *  - provider 只是「OpenAI 兼容 chat/completions」与「Gemini generateContent」
 *    两种报文格式的抽象 + 预置 endpoint/模型名；支持完全自定义 baseUrl
 *    （本地代理，如 Ollama http://localhost:11434/v1，key 可留空）。
 *  - 失败状态必须明确：未配置 → 引导去设置；网络/鉴权失败 → 显示错误与再試行。
 *  - 静态站无后端：请求由浏览器直接发往用户配置的 endpoint（需对方允许 CORS）。
 */
const YomuAI = {
    STORAGE_KEY: 'yomu_ai_config',

    // 预置 provider（不含任何密钥；baseUrl/model 可被用户覆盖）
    PRESETS: {
        zhipu: {
            label: '智谱AI (GLM)',
            format: 'openai',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        },
        kimi: {
            label: 'Kimi (Moonshot)',
            format: 'openai',
            baseUrl: 'https://api.moonshot.cn/v1',
            model: 'moonshot-v1-8k'
        },
        ark: {
            label: '火山ARK（需自填接入点）',
            format: 'openai',
            baseUrl: '',
            model: ''
        },
        custom: {
            label: '自定义 / 本地代理',
            format: 'openai',
            baseUrl: '',
            model: ''
        }
    },

    getConfig() {
        try {
            const raw = localStorage.getItem('yomu_ai_config');
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    saveConfig(cfg) {
        localStorage.setItem('yomu_ai_config', JSON.stringify(cfg));
    },

    clearConfig() {
        localStorage.removeItem('yomu_ai_config');
    },

    /** 配置是否可用（自定义 baseUrl 存在即可；key 允许为空=本地代理） */
    isConfigured() {
        const cfg = this.getConfig();
        return Boolean(cfg && cfg.baseUrl);
    },

    /**
     * 生成翻译/解译请求。kind: 'translate' | 'grammar'
     * 返回纯文本回复；抛错带用户可读 message。
     */
    async explain(text, kind = 'translate') {
        const cfg = this.getConfig();
        if (!cfg || !cfg.baseUrl) {
            const err = new Error('AI 未配置：设置 → AI 翻訳 に baseURL（と必要なら API キー）を入力してください');
            err.code = 'not_configured';
            throw err;
        }
        const prompts = {
            translate: {
                system: '你是日语翻译助手。把用户给出的日文段落翻译成简体中文，只输出译文，不要解释。',
                user: text
            },
            grammar: {
                system: '你是日语语法老师。对用户给出的日文段落做语法解说：逐句列出关键语法点（形式、含义、在句中的作用），用简体中文回答，简洁分条。',
                user: text
            }
        };
        const p = prompts[kind] || prompts.translate;
        const format = cfg.format === 'gemini' ? 'gemini' : 'openai';
        try {
            if (format === 'openai') {
                return await this._callOpenAI(cfg, p);
            }
            return await this._callGemini(cfg, p);
        } catch (e) {
            if (e.code === 'not_configured') throw e;
            const status = e.status ? `（HTTP ${e.status}）` : '';
            throw new Error(`AI リクエスト失敗${status}: ${e.message}`);
        }
    },

    async _callOpenAI(cfg, p) {
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
        const resp = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: cfg.model || 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: p.system },
                    { role: 'user', content: p.user }
                ],
                temperature: 0.3,
                max_tokens: 1024
            })
        });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            const err = new Error(body.slice(0, 200) || resp.statusText);
            err.status = resp.status;
            throw err;
        }
        const data = await resp.json();
        const content = data && data.choices && data.choices[0] &&
            data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('応答が空でした（モデル/モデル名を確認してください）');
        return String(content).trim();
    },

    async _callGemini(cfg, p) {
        if (!cfg.apiKey) {
            const err = new Error('Gemini 需要 API key');
            err.code = 'not_configured';
            throw err;
        }
        const base = cfg.baseUrl.replace(/\/+$/, '');
        const url = `${base}/models/${cfg.model || 'gemini-2.5-flash-lite'}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: p.system }] },
                contents: [{ role: 'user', parts: [{ text: p.user }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
            })
        });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            const err = new Error(body.slice(0, 200) || resp.statusText);
            err.status = resp.status;
            throw err;
        }
        const data = await resp.json();
        const parts = data && data.candidates && data.candidates[0] &&
            data.candidates[0].content && data.candidates[0].content.parts;
        const text = parts && parts.map(x => x.text || '').join('');
        if (!text) throw new Error('応答が空でした');
        return text.trim();
    }
};

window.YomuAI = YomuAI;
