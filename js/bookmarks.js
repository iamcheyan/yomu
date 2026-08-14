/**
 * Yomu Bookmarks — 书签/高亮/笔记 (B4)
 *
 * 段落稳定 ID: bookId + paraIndex + 内容哈希（djb2）。paraIndex 由解析顺序
 * 决定（同一书内容不变则稳定），paraHash 用于校验内容未漂移；导出备份含
 * 摘录文本，导入合并去重。
 *
 * 存储: YomuStorage key 'bookmarks' = {
 *   [bookId]: [ { i, h, ex, b, hl, n, at } ]   // i=paraIndex, h=hash,
 * }                                            // ex=excerpt, b=bookmark,
 *                                              // hl=highlight, n=note, at=createdAt
 */
const YomuBookmarks = {
    _all() {
        return YomuStorage.get('bookmarks', {});
    },

    _saveAll(all) {
        YomuStorage.set('bookmarks', all);
    },

    list(bookId) {
        return this._all()[bookId] || [];
    },

    /** 渲染期快速查询: { paraIndex: entry } */
    getMap(bookId) {
        const map = {};
        for (const e of this.list(bookId)) map[e.i] = e;
        return map;
    },

    hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(36);
    },

    _entry(bookId, paraIndex, para) {
        const all = this._all();
        const arr = all[bookId] || (all[bookId] = []);
        let e = arr.find(x => x.i === paraIndex);
        if (!e) {
            const content = (para && para.content) || '';
            e = {
                i: paraIndex,
                h: this.hash(content),
                ex: content.slice(0, 40),
                b: false, hl: false, n: '',
                at: Date.now()
            };
            arr.push(e);
        }
        return { all, e };
    },

    _cleanup(bookId) {
        // 条目三个标记全空时移除
        const all = this._all();
        const arr = all[bookId];
        if (!arr) return;
        const kept = arr.filter(e => e.b || e.hl || (e.n && e.n.trim()));
        if (kept.length === 0) delete all[bookId];
        else all[bookId] = kept;
        this._saveAll(all);
    },

    toggleBookmark(bookId, paraIndex, para) {
        const { all, e } = this._entry(bookId, paraIndex, para);
        e.b = !e.b;
        this._saveAll(all);
        this._cleanup(bookId);
        return e.b;
    },

    toggleHighlight(bookId, paraIndex, para) {
        const { all, e } = this._entry(bookId, paraIndex, para);
        e.hl = !e.hl;
        this._saveAll(all);
        this._cleanup(bookId);
        return e.hl;
    },

    setNote(bookId, paraIndex, note, para) {
        const { all, e } = this._entry(bookId, paraIndex, para);
        e.n = String(note || '').slice(0, 2000);
        this._saveAll(all);
        this._cleanup(bookId);
    },

    get(bookId, paraIndex) {
        return this.list(bookId).find(e => e.i === paraIndex) || null;
    },

    /**
     * 渲染钩子: reader._renderNextChunk 后调用，为区间内段落套用样式。
     */
    apply(bookId, fromIndex, toIndex) {
        if (!bookId) return;
        const map = this.getMap(bookId);
        for (let i = fromIndex; i < toIndex; i++) {
            const el = document.getElementById(`p-${i}`);
            if (!el) continue;
            const e = map[i];
            el.classList.toggle('para-highlight', Boolean(e && e.hl));
            el.classList.toggle('para-bookmarked', Boolean(e && e.b));
            el.classList.toggle('para-noted', Boolean(e && e.n && e.n.trim()));
        }
    },

    /** 重新套用全书（模式切换/reRender 后） */
    applyAll(bookId) {
        this.apply(bookId, 0, (typeof YomuReader !== 'undefined' && YomuReader._renderedCount) || 0);
    },

    jump(bookId, paraIndex) {
        if (typeof YomuReader === 'undefined') return;
        while (YomuReader._renderedCount <= paraIndex && YomuReader._renderedCount < YomuReader._paragraphs.length) {
            YomuReader._renderNextChunk();
        }
        const el = document.getElementById(`p-${paraIndex}`);
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    },

    /** 内容哈希校验: 内容漂移时返回 false（列表中标记 ⚠） */
    verify(bookId, entry) {
        if (typeof YomuReader === 'undefined' || !YomuReader._paragraphs) return null;
        const p = YomuReader._paragraphs[entry.i];
        if (!p) return false;
        return this.hash(p.content || '') === entry.h;
    },

    // ===== TOC 内のしおり区段 =====
    renderTocSection(container) {
        if (!container) return;
        const bookId = (typeof YomuReader !== 'undefined' && YomuReader.getCurrentBook()) ? YomuReader.getCurrentBook().id : null;
        if (!bookId) { container.innerHTML = ''; return; }
        const entries = this.list(bookId)
            .slice()
            .sort((a, b) => a.i - b.i);

        if (entries.length === 0) {
            container.innerHTML = '<div class="toc-empty">しおり・ハイライトはまだありません。本文を長押しで追加できます。</div>';
            return;
        }

        container.innerHTML = entries.map(e => `
            <div class="bookmark-item" data-para="${e.i}">
                <button class="bookmark-jump" data-para="${e.i}">
                    <span class="bookmark-marks">${e.b ? '⭐' : ''}${e.hl ? '🎨' : ''}${e.n ? '📝' : ''}</span>
                    <span class="bookmark-excerpt">${this._esc(e.ex || `段落 ${e.i}`)}${this.verify(bookId, e) === false ? ' <span class="bookmark-warn" title="内容が変更された可能性">⚠</span>' : ''}</span>
                    ${e.n ? `<span class="bookmark-note">${this._esc(e.n.slice(0, 60))}</span>` : ''}
                </button>
                <button class="bookmark-del" data-del="${e.i}" title="削除" aria-label="削除">×</button>
            </div>
        `).join('');

        container.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const i = parseInt(btn.dataset.del, 10);
                const el = document.getElementById(`p-${i}`);
                if (el) { el.classList.remove('para-highlight', 'para-bookmarked', 'para-noted'); }
                const all = this._all();
                if (all[bookId]) {
                    all[bookId] = all[bookId].filter(x => x.i !== i);
                    if (all[bookId].length === 0) delete all[bookId];
                    this._saveAll(all);
                }
                this.renderTocSection(container);
            });
        });
        container.querySelectorAll('.bookmark-jump').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.Yomu) Yomu.closeToc();
                this.jump(bookId, parseInt(btn.dataset.para, 10));
            });
        });
    },

    // ===== 导出 / 导入（备份） =====
    exportJSON() {
        const all = this._all();
        let count = 0;
        for (const k of Object.keys(all)) count += all[k].length;
        const doc = { app: 'yomu', type: 'bookmarks', version: 1, exportedAt: new Date().toISOString(), books: all };
        const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        a.href = URL.createObjectURL(blob);
        a.download = `yomu-bookmarks-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return count;
    },

    async importJSON(input) {
        let text = '';
        if (input instanceof File) {
            text = await new Promise((res) => {
                const fr = new FileReader();
                fr.onload = () => res(String(fr.result || ''));
                fr.onerror = () => res('');
                fr.readAsText(input);
            });
        } else {
            text = String(input || '');
        }
        if (!text) return { added: 0, error: 'ファイルを読み込めませんでした' };
        let doc;
        try { doc = JSON.parse(text); } catch (e) { return { added: 0, error: 'JSON の解析に失敗しました' }; }
        const incoming = doc && typeof doc === 'object' && doc.books && typeof doc.books === 'object' ? doc.books : null;
        if (!incoming) return { added: 0, error: 'しおりデータが見つかりません' };

        const all = this._all();
        let added = 0;
        for (const bookId of Object.keys(incoming)) {
            const arr = Array.isArray(incoming[bookId]) ? incoming[bookId] : [];
            const existing = new Set((all[bookId] || []).map(e => e.i));
            const merged = all[bookId] ? all[bookId].slice() : [];
            for (const e of arr) {
                const i = Number(e.i);
                if (!Number.isInteger(i) || i < 0 || existing.has(i)) continue;
                merged.push({
                    i,
                    h: String(e.h || ''),
                    ex: String(e.ex || '').slice(0, 40),
                    b: Boolean(e.b),
                    hl: Boolean(e.hl),
                    n: String(e.n || '').slice(0, 2000),
                    at: Number(e.at) || Date.now()
                });
                existing.add(i);
                added++;
            }
            merged.sort((a, b) => a.i - b.i);
            all[bookId] = merged;
        }
        this._saveAll(all);
        return { added };
    },

    _esc(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
};

window.YomuBookmarks = YomuBookmarks;
