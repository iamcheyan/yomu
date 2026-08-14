/**
 * Yomu Wordbook — 生词本 (B1)
 *
 * 阅读中点词收藏（surface/reading/meaning/source），本地持久化，
 * 列表 / 删除 / 导出 / 导入 JSON。完全离线；SRS 复习为后续扩展。
 *
 * 存储: YomuStorage key 'wordbook' = [
 *   { id, surface, reading, meaning, source: {bookId, bookTitle}, addedAt }
 * ]
 * id = `${surface}|${reading}` — 同词去重。
 */
const YomuWordbook = {
    list() {
        return YomuStorage.get('wordbook', []);
    },

    _save(words) {
        YomuStorage.set('wordbook', words);
    },

    makeId(surface, reading) {
        return `${surface || ''}|${reading || ''}`;
    },

    has(surface, reading) {
        const id = this.makeId(surface, reading);
        return this.list().some(w => w.id === id);
    },

    /**
     * 收藏词条。meaning 允许为空（词典未收录时仍可记词）。
     * source 取当前阅读的书。返回 true=新增, false=已存在。
     */
    add(surface, reading, meaning) {
        if (!surface && !reading) return false;
        const id = this.makeId(surface, reading);
        const words = this.list();
        if (words.some(w => w.id === id)) return false;

        const book = (typeof YomuReader !== 'undefined' && YomuReader.getCurrentBook()) || {};
        words.push({
            id,
            surface: surface || '',
            reading: reading || '',
            meaning: meaning || '',
            source: { bookId: book.id || '', bookTitle: book.title || '' },
            addedAt: Date.now()
        });
        this._save(words);
        return true;
    },

    remove(id) {
        this._save(this.list().filter(w => w.id !== id));
    },

    count() {
        return this.list().length;
    },

    // ===== 导出 / 导入 =====
    exportJSON() {
        const words = this.list();
        const doc = {
            app: 'yomu',
            type: 'wordbook',
            version: 1,
            exportedAt: new Date().toISOString(),
            words
        };
        const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        a.href = URL.createObjectURL(blob);
        a.download = `yomu-wordbook-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return words.length;
    },

    /**
     * 导入 JSON（文件或文本）。合并去重（已存在同 id 的词条保留原条目）。
     * 返回 {added, skipped, error?}。
     */
    importJSON(input) {
        return new Promise((resolve) => {
            const readText = (file) => {
                const fr = new FileReader();
                fr.onload = () => resolve(String(fr.result || ''));
                fr.onerror = () => resolve('');
                fr.readAsText(file);
            };
            if (input instanceof File || (input && typeof input.file === 'object')) {
                readText(input.file || input);
                return;
            }
            resolve(typeof input === 'string' ? input : '');
        }).then((text) => {
            if (!text) return { added: 0, skipped: 0, error: 'ファイルを読み込めませんでした' };
            let doc;
            try {
                doc = JSON.parse(text);
            } catch (e) {
                return { added: 0, skipped: 0, error: 'JSON の解析に失敗しました' };
            }
            const incoming = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.words) ? doc.words : null);
            if (!incoming) return { added: 0, skipped: 0, error: '単語帳データが見つかりません' };

            const words = this.list();
            const ids = new Set(words.map(w => w.id));
            let added = 0, skipped = 0;
            for (const w of incoming) {
                const surface = String(w.surface || '');
                const reading = String(w.reading || '');
                if (!surface && !reading) { skipped++; continue; }
                const id = w.id || this.makeId(surface, reading);
                if (ids.has(id)) { skipped++; continue; }
                words.push({
                    id,
                    surface,
                    reading,
                    meaning: String(w.meaning || ''),
                    source: (w.source && typeof w.source === 'object') ? {
                        bookId: String(w.source.bookId || ''),
                        bookTitle: String(w.source.bookTitle || '')
                    } : { bookId: '', bookTitle: '' },
                    addedAt: Number(w.addedAt) || Date.now()
                });
                ids.add(id);
                added++;
            }
            this._save(words);
            return { added, skipped };
        });
    },

    // ===== 単語帳面板 =====
    isOpen() {
        const panel = document.getElementById('wordbook-panel');
        return !!(panel && panel.classList.contains('open'));
    },

    open() {
        this._renderPanel();
        document.getElementById('wordbook-overlay')?.classList.add('active');
        document.getElementById('wordbook-panel')?.classList.add('open');
    },

    close() {
        document.getElementById('wordbook-overlay')?.classList.remove('active');
        document.getElementById('wordbook-panel')?.classList.remove('open');
    },

    toggle() {
        this.isOpen() ? this.close() : this.open();
    },

    _renderPanel() {
        const listEl = document.getElementById('wordbook-list');
        const countEl = document.getElementById('wordbook-count');
        if (!listEl) return;
        const words = this.list();
        if (countEl) countEl.textContent = `${words.length} 語`;

        if (words.length === 0) {
            listEl.innerHTML = '<div class="wordbook-empty">まだ保存した単語がありません。<br>本文の単語をタップして「★ 単語帳に保存」で追加できます。</div>';
            return;
        }

        listEl.innerHTML = words.map((w, i) => `
            <div class="wordbook-item" data-id="${this._esc(w.id)}">
                <div class="wordbook-item-main">
                    <div class="wordbook-word">${this._esc(w.surface || w.reading)}</div>
                    ${w.reading && w.surface ? `<div class="wordbook-reading">${this._esc(w.reading)}</div>` : ''}
                    ${w.meaning ? `<div class="wordbook-meaning">${this._esc(w.meaning)}</div>` : ''}
                    ${w.source && w.source.bookTitle ? `<div class="wordbook-source">出典: ${this._esc(w.source.bookTitle)}</div>` : ''}
                </div>
                <button class="wordbook-del-btn" data-del="${i}" title="削除" aria-label="削除">×</button>
            </div>
        `).join('');

        listEl.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.del, 10);
                const w = this.list()[idx];
                if (w) this.remove(w.id);
                this._renderPanel();
            });
        });
    },

    _esc(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
};

/**
 * <input type="file"> onchange 处理器（index.html 内联引用）。
 */
async function YomuWordbookImport(input) {
    const file = input.files && input.files[0];
    input.value = ''; // 允许重复选择同一文件
    if (!file) return;
    const result = await YomuWordbook.importJSON(file);
    if (window.Yomu && typeof Yomu.showToast === 'function') {
        if (result.error) {
            Yomu.showToast(`インポート失敗: ${result.error}`, { type: 'toast-error' });
        } else {
            Yomu.showToast(`${result.added} 語を追加、${result.skipped} 語をスキップ`);
        }
    }
    YomuWordbook._renderPanel();
}

window.YomuWordbook = YomuWordbook;
