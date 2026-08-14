/**
 * Yomu Fonts - 汉字/假名分别指定（unicode-range 分流）
 *
 * 原理：CSS font-family 无法按字符类型选字体，故用两个 @font-face：
 *   - YomuKana  ← 假名槽位选中的字体（range: 平假名+片假名+半角片假名）
 *   - YomuKanji ← 汉字槽位选中的字体（range: CJK 统一表意+扩展A+兼容）
 * 正文 font-family = "YomuKana", "YomuKanji", 系统栈：假名专属 range
 * 命中假名字体，其余（汉字/拉丁/标点）落到汉字字体，最终回退系统字体。
 * family 名与槽位绑定（而非字体 id），切换槽位即重建对应 @font-face。
 *
 * 字体 woff2 已 git 入库 assets/fonts/（共约 5.6MB < 50MB 上限，
 * APK 构建随 assets/** 打包，Web 端由 Service Worker 缓存离线可用）。
 * local 为仓库文件；cdn 为 fontsource 固定版本直链，local 不可达时兜底。
 * 全部字体为 SIL Open Font License 1.1（见 assets/fonts/licenses/）。
 */
const YomuFonts = (() => {

    // unicode-range：与 docs/FONT_SYSTEM_GOAL.md 第三节一致
    const RANGE_KANA = 'U+3040-30FF, U+31F0-31FF, U+FF66-FF9D';   // ひらがな+カタカナ+半角カナ
    const RANGE_KANJI = 'U+4E00-9FFF, U+3400-4DBF, U+F900-FAFF';  // CJK統合漢字+拡張A+互換

    const MINCHO = '"Hiragino Mincho ProN", "Yu Mincho", "MS Mincho", serif';
    const GOTHIC = '"Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';

    // 字体注册表（全部 OFL 1.1）
    const FONTS = {
        'noto-serif-jp': {
            label: 'Noto Serif JP（明朝）',
            local: 'assets/fonts/noto-serif-jp-400.woff2',
            cdn: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-jp@5.3.0/files/noto-serif-jp-japanese-400-normal.woff2'
        },
        'noto-sans-jp': {
            label: 'Noto Sans JP（ゴシック）',
            local: 'assets/fonts/noto-sans-jp-400.woff2',
            cdn: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5.3.0/files/noto-sans-jp-japanese-400-normal.woff2'
        },
        'klee-one': {
            label: 'Klee One（教科書体）',
            local: 'assets/fonts/klee-one-400.woff2',
            cdn: 'https://cdn.jsdelivr.net/npm/@fontsource/klee-one@5.3.0/files/klee-one-japanese-400-normal.woff2'
        },
        'zen-maru-gothic': {
            label: 'Zen Maru Gothic（圆体）',
            local: 'assets/fonts/zen-maru-gothic-400.woff2',
            cdn: 'https://cdn.jsdelivr.net/npm/@fontsource/zen-maru-gothic@5.3.0/files/zen-maru-gothic-japanese-400-normal.woff2'
        }
    };

    // 一键预设：明朝经典 / 教科書柔和 / 圆体轻松
    const PRESETS = {
        mincho: { label: '明朝経典', kanji: 'noto-serif-jp', kana: 'noto-serif-jp' },
        textbook: { label: '教科書柔和', kanji: 'klee-one', kana: 'noto-sans-jp' },
        maru: { label: '圆体輕鬆', kanji: 'noto-sans-jp', kana: 'zen-maru-gothic' }
    };

    const _blobSrc = {};        // 字体 id -> blob: URL（已下载）
    const _ready = new Set();
    let _current = { kanji: 'mincho', kana: 'mincho' };

    function _face(fam, src, range) {
        return `@font-face{font-family:"${fam}";font-style:normal;font-weight:400;` +
            `font-display:swap;src:${src};unicode-range:${range};}`;
    }

    function _srcFor(id) {
        if (_blobSrc[id]) return `url("${_blobSrc[id]}") format("woff2")`;
        const f = FONTS[id];
        return `url("${f.local}") format("woff2"),url("${f.cdn}") format("woff2")`;
    }

    /** 按当前槽位重建两个 @font-face（同 family 重复注册时后者覆盖前者，
        故必须整体重建、槽位独占 family） */
    function _rebuild() {
        let el = document.getElementById('yomu-font-faces');
        if (!el) {
            el = document.createElement('style');
            el.id = 'yomu-font-faces';
            document.head.appendChild(el);
        }
        let css = '';
        if (FONTS[_current.kana]) css += _face('YomuKana', _srcFor(_current.kana), RANGE_KANA);
        if (FONTS[_current.kanji]) css += _face('YomuKanji', _srcFor(_current.kanji), RANGE_KANJI);
        el.textContent = css;
    }

    /** 带下载进度的 blob 获取（XHR；file:// 或断网时 reject） */
    function _fetchBlob(url, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'blob';
            xhr.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(Math.min(99, Math.round(e.loaded / e.total * 100)));
                }
            };
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0
                ? resolve(xhr.response)
                : reject(new Error('HTTP ' + xhr.status));
            xhr.onerror = () => reject(new Error('network'));
            xhr.send();
        });
    }

    /**
     * 懒加载：XHR 下载（带进度）→ blob: src → 重建 @font-face → 等待
     * 引用该字体的槽位真正可用。local 失败依次尝试 cdn；全部失败则保留
     * URL 注册，由浏览器自行加载（Android WebView file:// 场景）。
     * @returns {Promise<boolean>} 是否加载成功
     */
    async function load(id, onProgress) {
        const font = FONTS[id];
        if (!font) return false;
        if (_ready.has(id)) {
            if (onProgress) onProgress(100);
            return true;
        }
        if (!_blobSrc[id]) {
            try {
                const blob = await _fetchBlob(font.local, onProgress)
                    .catch(() => _fetchBlob(font.cdn, onProgress));
                if (blob) {
                    _blobSrc[id] = URL.createObjectURL(blob);
                    _rebuild();
                }
            } catch (e) {
                console.warn('[YomuFonts] blob download failed, fallback to url():', id, e.message);
            }
        }
        try {
            const loads = [];
            if (_current.kana === id) loads.push(document.fonts.load('16px YomuKana', 'かなカナ'));
            if (_current.kanji === id) loads.push(document.fonts.load('16px YomuKanji', '漢字'));
            await Promise.all(loads);
            const ok = (_current.kana !== id || document.fonts.check('16px YomuKana', 'か')) &&
                       (_current.kanji !== id || document.fonts.check('16px YomuKanji', '漢'));
            if (ok) _ready.add(id);
            if (onProgress) onProgress(100);
            return ok;
        } catch (e) {
            console.warn('[YomuFonts] load failed:', id, e);
            return false;
        }
    }

    function _sysStack(v) {
        return v === 'gothic' ? GOTHIC : MINCHO;
    }

    /**
     * 应用组合：正文 font-family = 假名字体在前、汉字字体在后。
     * 槽位值为 'mincho'/'gothic'（系统，无法按 range 分流）或字体 id。
     * 系统槽位作为兜底栈追加；双系统 = 传统整体切换（假名槽优先）。
     */
    function apply(kanjiId, kanaId) {
        _current = { kanji: kanjiId || 'mincho', kana: kanaId || 'mincho' };
        _rebuild();
        const kanaCustom = Boolean(FONTS[_current.kana]);
        const kanjiCustom = Boolean(FONTS[_current.kanji]);

        const parts = [];
        if (kanaCustom) parts.push('YomuKana');
        if (kanjiCustom) parts.push('YomuKanji');
        // 兜底系统栈：单侧自定义时取对侧系统槽；双自定义用明朝；双系统用假名槽
        let sys;
        if (!kanaCustom && !kanjiCustom) sys = _sysStack(_current.kana);
        else if (!kanjiCustom) sys = _sysStack(_current.kanji);
        else if (!kanaCustom) sys = _sysStack(_current.kana);
        else sys = MINCHO;
        parts.push(sys);

        document.documentElement.style.setProperty('--reader-font-family', parts.join(', '));
        document.documentElement.style.setProperty('--preview-kana-font',
            kanaCustom ? `"YomuKana", ${MINCHO}` : _sysStack(_current.kana));
        document.documentElement.style.setProperty('--preview-kanji-font',
            kanjiCustom ? `"YomuKanji", ${MINCHO}` : _sysStack(_current.kanji));

        return _current;
    }

    /** 当前选择是否与给定预设一致（供预设高亮） */
    function isPresetActive(presetId) {
        const p = PRESETS[presetId];
        return Boolean(p) && p.kanji === _current.kanji && p.kana === _current.kana;
    }

    return {
        FONTS, PRESETS, load, apply, isPresetActive,
        get current() { return { ..._current }; }
    };
})();
