/**
 * Yomu Fonts - 本文（正文）与 振りがな（ルビ）分别指定字体
 *
 * 原理：
 *   - YomuBodyFont ← 本文槽位（正文文字，覆盖汉字/假名/英数/标点）
 *   - YomuRubyFont ← 振りがな槽位（<rt> 注音专属字体，支持圆体/明朝/黑体/教科书体）
 * 读者正文使用 --reader-font-family，振假名使用 --ruby-font-family。
 * 网站标题与书籍封面使用 --display-font-family，并跟随正文选择。
 * 针对日语阅读与学习优化，可在正文使用明朝/教科书体的同时，为小字注音指定清晰可辨的圆体或无衬线体。
 *
 * 字体 woff2 已入库 assets/fonts/（共约 5.6MB），离线可用。
 * local 为仓库文件；cdn 为 fontsource 固定版本直链。全部字体为 SIL Open Font License 1.1。
 */
const YomuFonts = (() => {

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
            label: 'Zen Maru Gothic（丸ゴシック）',
            local: 'assets/fonts/zen-maru-gothic-400.woff2',
            cdn: 'https://cdn.jsdelivr.net/npm/@fontsource/zen-maru-gothic@5.3.0/files/zen-maru-gothic-japanese-400-normal.woff2'
        }
    };

    // 一键预设：明朝经典 / 教科書体 / 丸ゴシック
    const PRESETS = {
        mincho: { label: '明朝経典', body: 'noto-serif-jp', ruby: 'noto-serif-jp', kanji: 'noto-serif-jp', kana: 'noto-serif-jp' },
        textbook: { label: '教科書体', body: 'klee-one', ruby: 'zen-maru-gothic', kanji: 'klee-one', kana: 'zen-maru-gothic' },
        maru: { label: '丸ゴシック', body: 'zen-maru-gothic', ruby: 'zen-maru-gothic', kanji: 'zen-maru-gothic', kana: 'zen-maru-gothic' }
    };

    const _blobSrc = {};        // 字体 id -> blob: URL（已下载）
    const _ready = new Set();
    let _current = { body: 'mincho', ruby: 'mincho' };

    function _face(fam, src) {
        return `@font-face{font-family:"${fam}";font-style:normal;font-weight:400;` +
            `font-display:swap;src:${src};}`;
    }

    function _srcFor(id) {
        if (_blobSrc[id]) return `url("${_blobSrc[id]}") format("woff2")`;
        const f = FONTS[id];
        return `url("${f.local}") format("woff2"),url("${f.cdn}") format("woff2")`;
    }

    /** 重建 @font-face */
    function _rebuild() {
        let el = document.getElementById('yomu-font-faces');
        if (!el) {
            el = document.createElement('style');
            el.id = 'yomu-font-faces';
            document.head.appendChild(el);
        }
        let css = '';
        if (FONTS[_current.body]) {
            css += _face('YomuBodyFont', _srcFor(_current.body));
            css += _face('YomuKanji', _srcFor(_current.body)); // 兼容旧引用
        }
        if (FONTS[_current.ruby]) {
            css += _face('YomuRubyFont', _srcFor(_current.ruby));
            css += _face('YomuKana', _srcFor(_current.ruby)); // 兼容旧引用
        }

        // 注册各个字体本身的名字，方便下拉菜单预览
        for (const id of Object.keys(FONTS)) {
            css += _face(id, _srcFor(id));
        }

        // 保留封面字体别名，兼容旧样式；实际封面样式现在跟随正文选择。
        css += _face('YomuCoverSerif', _srcFor('noto-serif-jp'));
        css += _face('YomuCoverSans', _srcFor('noto-sans-jp'));
        css += _face('YomuCoverAccent', _srcFor('klee-one'));
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
     * 懒加载：XHR 下载（带进度）→ blob: src → 重建 @font-face
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
            if (_current.body === id) loads.push(document.fonts.load('16px YomuBodyFont', '吾輩は猫である'));
            if (_current.ruby === id) loads.push(document.fonts.load('16px YomuRubyFont', 'わがはい'));
            await Promise.all(loads);
            _ready.add(id);
            if (onProgress) onProgress(100);
            return true;
        } catch (e) {
            console.warn('[YomuFonts] load failed:', id, e);
            return false;
        }
    }

    function _sysStack(v) {
        return v === 'gothic' ? GOTHIC : MINCHO;
    }

    /**
     * 应用组合：
     * @param {string} bodyId 本文字体（正文）
     * @param {string} rubyId 振りがな字体（ルビ）
     */
    function apply(bodyId, rubyId) {
        _current = {
            body: bodyId || 'mincho',
            ruby: rubyId || 'mincho'
        };
        _rebuild();

        const bodyCustom = Boolean(FONTS[_current.body]);
        const rubyCustom = Boolean(FONTS[_current.ruby]);

        // 本文字体栈
        const bodyStack = bodyCustom
            ? `"YomuBodyFont", ${_current.body === 'noto-sans-jp' ? GOTHIC : MINCHO}`
            : _sysStack(_current.body);

        // 振假名字体栈
        const rubyStack = rubyCustom
            ? `"YomuRubyFont", ${_current.ruby === 'noto-serif-jp' ? MINCHO : GOTHIC}`
            : _sysStack(_current.ruby);

        document.documentElement.style.setProperty('--reader-font-family', bodyStack);
        document.documentElement.style.setProperty('--ruby-font-family', rubyStack);
        document.documentElement.style.setProperty('--display-font-family', bodyStack);

        // 设置面板预览变量
        document.documentElement.style.setProperty('--preview-body-font', bodyStack);
        document.documentElement.style.setProperty('--preview-ruby-font', rubyStack);
        document.documentElement.style.setProperty('--preview-kanji-font', bodyStack);
        document.documentElement.style.setProperty('--preview-kana-font', rubyStack);

        return _current;
    }

    /** 当前选择是否与给定预设一致（供预设高亮） */
    function isPresetActive(presetId) {
        const p = PRESETS[presetId];
        if (!p) return false;
        const curBody = _current.body;
        const curRuby = _current.ruby;
        return (p.body === curBody || p.kanji === curBody) &&
               (p.ruby === curRuby || p.kana === curRuby);
    }

    return {
        FONTS, PRESETS, load, apply, isPresetActive,
        get current() {
            return {
                body: _current.body,
                ruby: _current.ruby,
                kanji: _current.body, // 兼容旧属性访问
                kana: _current.ruby
            };
        }
    };
})();
