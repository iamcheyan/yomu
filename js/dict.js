/**
 * Yomu Dict — 按需词典 (A3) + JLPT 难度标注 (B5)
 *
 * 数据:
 *  - data/dict/jmdict.json — EDRDG JMdict (CC BY-SA 4.0) 常用语精简版，
 *    scripts/build_dict.py 生成（来源/许可证/体积见 data/dict/README.md）。
 *  - data/dict/jlpt.json — Jonathan Waller (tanos.co.uk, CC-BY) JLPT 词表，
 *    scripts/build_jlpt.py 生成。严格按词表显示 N5..N1；词表外显示「級外」，
 *    多读音无法对齐显示「級不明」，绝不猜测级别。
 *
 * 设计约束:
 *  - 完全惰性: 只在用户第一次点击词元时才开始 fetch，首屏零开销。
 *  - 失败可见且可恢复: 词典载入失败显示错误 + 再試行，绝不阻塞阅读器。
 *  - JLPT 词表为附属数据，加载失败时静默省略标注（不影响词典弹窗）。
 *  - 离线: 首次成功 fetch 后由 sw.js 的 data/ cache-first 策略缓存。
 *  - Android file:// 兼容: 用 XHR（不带 cache-bust 参数）。
 */
const YomuDict = {
    _state: 'idle',          // idle | loading | ready | error
    _data: null,             // { meta, entries, index }
    _loadPromise: null,
    _popup: null,
    _lastToken: null,

    // ===== B5: JLPT =====
    _jlptData: null,
    _jlptPromise: null,

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

    loadJlpt() {
        if (this._jlptData) return Promise.resolve(true);
        if (this._jlptPromise) return this._jlptPromise;
        this._jlptPromise = new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'data/dict/jlpt.json', true);
            xhr.onload = () => {
                if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (!data || !data.voc) throw new Error('bad jlpt data');
                        this._jlptData = data;
                        resolve(true);
                    } catch (e) {
                        console.error('[Dict] jlpt parse failed:', e);
                        resolve(false);
                    }
                } else {
                    resolve(false);
                }
            };
            xhr.onerror = () => resolve(false);
            xhr.send();
        }).finally(() => { this._jlptPromise = null; });
        return this._jlptPromise;
    },

    /**
     * 查 JLPT 级别。返回 'N5'..'N1' | 'outside'（词表外）| null（不确定/数据未载入）。
     * 严格按词形+读音精确匹配；多义且读音不匹配视为不确定，不猜。
     */
    jlptLevel(surface, reading) {
        if (!this._jlptData) return null;
        const voc = this._jlptData.voc;
        const entries = voc[surface] || (reading ? voc[reading] : null);
        if (!entries || entries.length === 0) return 'outside';
        if (reading) {
            const hit = entries.find(e => e[0] === reading);
            if (hit) return 'N' + hit[1];
        }
        if (entries.length === 1) return 'N' + entries[0][1];
        return null;
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

        this._renderJlptBadge(token, surface, reading);
    },

    async _renderJlptBadge(token, surface, reading) {
        // B5: 设置关闭时不显示；词表加载失败时静默省略（不阻塞弹窗）
        try {
            const settings = YomuStorage.getSettings();
            if (settings.jlptShow === false) return;
        } catch (e) { /* storage 不可用时按默认显示 */ }

        const ok = await this.loadJlpt();
        if (this._lastToken !== token) return;
        const popup = this._popup;
        if (!ok || !popup || !popup.classList.contains('active')) return;

        let row = popup.querySelector('.dict-jlpt');
        if (!row) {
            row = document.createElement('div');
            row.className = 'dict-jlpt';
            popup.appendChild(row);
        }
        const level = this.jlptLevel(surface, reading);
        if (level === 'outside') {
            row.innerHTML = '<span class="dict-jlpt-label">JLPT</span><span class="dict-jlpt-outside">級外（詞表外）</span>';
        } else if (level) {
            row.innerHTML = `<span class="dict-jlpt-label">JLPT</span><span class="dict-jlpt-level jlpt-${level.toLowerCase()}">${level}</span>`;
        } else {
            row.innerHTML = '<span class="dict-jlpt-label">JLPT</span><span class="dict-jlpt-outside">級不明（多読み）</span>';
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
        const canSave = view.status === 'found' || view.status === 'notfound';
        const saved = canSave && window.YomuWordbook && YomuWordbook.has(view.surface, view.reading);
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
        if (canSave && window.YomuWordbook) {
            const meaning = view.status === 'found' ? (view.entry.g || []).join(' / ') : '';
            body += `
                <button class="dict-save-btn${saved ? ' saved' : ''}" type="button"
                    data-surface="${this._esc(view.surface || '')}" data-reading="${this._esc(view.reading || '')}"
                    data-meaning="${this._esc(meaning)}">${saved ? '★ 保存済み' : '☆ 単語帳に保存'}</button>
            `;
        }

        el.innerHTML = body;
        el.classList.add('active');

        const saveBtn = el.querySelector('.dict-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const added = YomuWordbook.add(
                    saveBtn.dataset.surface, saveBtn.dataset.reading, saveBtn.dataset.meaning);
                if (added) {
                    saveBtn.textContent = '★ 保存済み';
                    saveBtn.classList.add('saved');
                }
            });
        }
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
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
};

window.YomuDict = YomuDict;
document.addEventListener('DOMContentLoaded', () => YomuDict.init());
