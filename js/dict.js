/**
 * Yomu Dict — 按需词典 (A3)
 *
 * 数据: data/dict/jmdict.json — EDRDG JMdict (CC BY-SA 4.0) 常用语精简版，
 *       由 scripts/build_dict.py 生成（来源/许可证/体积见 data/dict/README.md）。
 *
 * 设计约束:
 *  - 完全惰性: 只在用户第一次点击词元时才开始 fetch（3.9MB），首屏零开销。
 *  - 失败可见且可恢复: 载入失败时弹出卡片显示错误 + 再試行，绝不阻塞阅读器。
 *  - 离线: 首次成功 fetch 后由 sw.js 的 data/ cache-first 策略缓存，离线可用。
 *  - Android file:// 兼容: 用 XHR（不带 cache-bust 参数），与 reader.js 同款。
 */
const YomuDict = {
    _state: 'idle',          // idle | loading | ready | error
    _data: null,             // { meta, entries, index }
    _loadPromise: null,
    _popup: null,
    _lastToken: null,

    state() {
        return this._state;
    },

    isReady() {
        return this._state === 'ready';
    },

    /**
     * 按需载入词典。多次调用共享同一个 promise；失败后允许重试。
     */
    load() {
        if (this._state === 'ready') return Promise.resolve(true);
        if (this._loadPromise) return this._loadPromise;

        this._state = 'loading';
        this._loadPromise = new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            // 无 cache-bust 参数: Android WebView file:// XHR 带 "?" 会失败
            xhr.open('GET', 'data/dict/jmdict.json', true);
            xhr.onload = () => {
                if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (!data || !data.index || !data.entries) {
                            throw new Error('invalid dictionary format');
                        }
                        this._data = data;
                        this._state = 'ready';
                        console.log('[Dict] loaded:', data.meta ? `${data.meta.entries} entries` : 'ok');
                        resolve(true);
                    } catch (e) {
                        console.error('[Dict] parse failed:', e);
                        this._state = 'error';
                        resolve(false);
                    }
                } else {
                    console.error(`[Dict] XHR failed with status ${xhr.status}`);
                    this._state = 'error';
                    resolve(false);
                }
            };
            xhr.onerror = () => {
                console.error('[Dict] network error');
                this._state = 'error';
                resolve(false);
            };
            xhr.send();
        }).finally(() => {
            // 允许失败后的下一次 tap 重新发起请求
            this._loadPromise = null;
        });
        return this._loadPromise;
    },

    _toHira(str) {
        let out = '';
        for (const ch of str) {
            const o = ch.codePointAt(0);
            out += (o >= 0x30A1 && o <= 0x30F6) ? String.fromCodePoint(o - 0x60) : ch;
        }
        return out;
    },

    /**
     * 查词: 先按辞书形(見出し語)精确命中，再按读音命中。
     * 返回 entry {k:[], r:[], g:[]} 或 null（未收录/未载入）。
     */
    lookup(surface, reading) {
        if (!this.isReady() || !this._data) return null;
        const index = this._data.index;
        const entries = this._data.entries;

        const pickBest = (ids, wantSurface) => {
            if (!ids || ids.length === 0) return null;
            // 同一 key 多义时优先 見出し語 == surface 的条目，其次第一条
            for (const i of ids) {
                const e = entries[i];
                if (e && e.k && e.k.some(k => k === wantSurface)) return e;
            }
            return entries[ids[0]] || null;
        };

        if (surface) {
            const hit = pickBest(index[this._toHira(surface)], surface);
            if (hit) return hit;
        }
        if (reading) {
            const hit = pickBest(index[this._toHira(reading)], surface);
            if (hit) return hit;
        }
        return null;
    },

    // ===== 点词弹窗 =====
    init() {
        document.addEventListener('click', (e) => {
            const token = e.target.closest && (
                e.target.closest('.word-token') ||
                e.target.closest('#novel-content ruby')   // 阅读器 internal 振り仮名模式
            );
            if (token) {
                e.preventDefault();
                e.stopPropagation();
                this.showPopup(token);
                return;
            }
            // 点击弹窗外部（且不是弹窗内部）时关闭
            if (this._popup && !this._popup.contains(e.target)) {
                this.hidePopup();
            }
        }, true); // capture: 阅读器的 controls-toggle 逻辑在冒泡段，先接管词元点击
        window.addEventListener('scroll', () => this.hidePopup(), { passive: true });
        window.addEventListener('resize', () => this.hidePopup());
    },

    /**
     * 从词元元素提取 (surface, reading):
     *  - .word-token (kuromoji): data-surface / data-reading
     *  - #novel-content ruby (internal 振り仮名): 直接子文本节点 + <rt>
     */
    _extract(token) {
        if (token.dataset && token.dataset.surface) {
            return [token.dataset.surface, token.dataset.reading || ''];
        }
        let surface = '';
        for (const n of token.childNodes) {
            if (n.nodeType === 3) surface += n.textContent;
            else if (n.nodeName === 'RB') surface += n.textContent;
        }
        const rt = token.querySelector('rt');
        return [surface.trim(), rt ? rt.textContent.trim() : ''];
    },

    async showPopup(token) {
        const [surface, reading] = this._extract(token);

        this._lastToken = token;
        this._renderPopup(token, { status: 'loading' });

        const ok = await this.load();
        if (this._lastToken !== token) return; // 用户已点了别的词

        if (!ok) {
            this._renderPopup(token, { status: 'error' });
            return;
        }

        const entry = this.lookup(surface, reading);
        if (!entry) {
            this._renderPopup(token, { status: 'notfound', surface, reading });
        } else {
            this._renderPopup(token, { status: 'found', surface, reading, entry });
        }
    },

    _renderPopup(token, view) {
        let el = this._popup;
        if (!el || !el.isConnected) {
            el = document.createElement('div');
            el.className = 'dict-popup';
            el.addEventListener('click', (e) => e.stopPropagation());
            document.body.appendChild(el);
            this._popup = el;
        }

        let body = '';
        if (view.status === 'loading') {
            body = `<div class="dict-status">辞書を読み込み中...</div>`;
        } else if (view.status === 'error') {
            body = `
                <div class="dict-status dict-status-error">辞書の読み込みに失敗しました</div>
                <button class="dict-retry-btn" type="button">再試行</button>
            `;
        } else if (view.status === 'notfound') {
            body = `
                <div class="dict-word">${this._esc(view.surface)}</div>
                ${view.reading ? `<div class="dict-reading">${this._esc(view.reading)}</div>` : ''}
                <div class="dict-status">この語は辞書に収録されていません</div>
            `;
        } else {
            const e = view.entry;
            const kana = (e.r && e.r.length) ? e.r[0] : '';
            body = `
                <div class="dict-word">${this._esc((e.k && e.k[0]) || view.surface)}</div>
                ${kana ? `<div class="dict-reading">${this._esc(kana)}</div>` : ''}
                ${(e.g && e.g.length) ? `<div class="dict-glosses">${e.g.map(g => this._esc(g)).join('<br>')}</div>` : ''}
            `;
        }

        el.innerHTML = body;
        el.classList.add('active');

        const retryBtn = el.querySelector('.dict-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                this._state = 'idle'; // load() 内部还有守卫，这里显式重置状态
                this.showPopup(this._lastToken);
            });
        }

        // 定位: 词元在视口内时放在其下方/上方；词元在视口外（程序化点击、
        // 恢复滚动后）时居中兜底；水平 clamp。
        const rect = token.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        el.style.visibility = 'hidden';
        el.style.left = '0px';
        el.style.top = '0px';
        requestAnimationFrame(() => {
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            const onScreen = rect.bottom > 0 && rect.top < vh;
            let left, top;
            if (onScreen) {
                left = rect.left + rect.width / 2 - w / 2;
                left = Math.max(8, Math.min(left, vw - w - 8));
                top = rect.bottom + 8;
                if (top + h > vh - 8) top = Math.max(8, rect.top - h - 8);
            } else {
                left = vw / 2 - w / 2;
                top = vh / 2 - h / 2;
            }
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
            el.style.visibility = '';
        });
    },

    hidePopup() {
        if (this._popup) {
            this._popup.classList.remove('active');
            this._popup.remove();
            this._popup = null;
        }
        this._lastToken = null;
    },

    _esc(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};

window.YomuDict = YomuDict;
document.addEventListener('DOMContentLoaded', () => YomuDict.init());
