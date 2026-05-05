/**
 * Yomu App - Main application controller
 */
const Yomu = {
    reader: YomuReader,
    _settingsOpen: false,
    _vocabViewOpen: false,

    async init() {
        const loading = document.getElementById('loading-overlay');
        const msg = document.getElementById('loading-msg');

        try {
            // Load dictionary
            msg.textContent = '辞書を読み込み中...';
            await YomuDict.init();

            // Initialize tokenizer
            msg.textContent = '形態素解析器を初期化中...';
            await YomuTokenizer.init();

            // Load book list
            msg.textContent = '書籍リストを読み込み中...';
            await YomuReader.init();

            // Apply saved settings
            this._applySettings();

            // Render book list
            this._renderBookList();

            // Hide loading
            loading.classList.add('hidden');
        } catch (e) {
            console.error('Init failed:', e);
            msg.textContent = '初期化に失敗しました。ページを再読み込みしてください。';
        }
    },

    _renderBookList() {
        const books = YomuReader.getBooks();
        const grid = document.getElementById('book-grid');
        let html = '';

        for (const book of books) {
            const progress = YomuStorage.getProgress(book.id);
            const percent = Math.round(progress.scrollPercent || 0);

            html += `
                <div class="book-card" onclick="Yomu.openBook('${book.id}')">
                    <div class="book-info">
                        <div class="book-title">${this._escapeHtml(book.title)}</div>
                        <div class="book-author">${this._escapeHtml(book.author)}</div>
                        <div class="book-desc">${this._escapeHtml(book.desc || '')}</div>
                        ${progress.lastRead ? `<div class="book-progress">読了 ${percent}%</div>` : ''}
                        ${progress.lastRead ? `<div class="progress-bar-container"><div class="progress-bar-fill" style="width:${percent}%"></div></div>` : ''}
                    </div>
                    <div class="book-meta">
                        ${book.year || ''}
                    </div>
                </div>
            `;
        }

        grid.innerHTML = html;
    },

    async openBook(bookId) {
        await YomuReader.openBook(bookId);
    },

    showBookList() {
        // Save current scroll position before leaving
        document.getElementById('reader-view').classList.remove('active');
        document.getElementById('vocab-view').classList.add('hidden');
        document.getElementById('book-list-view').classList.remove('hidden');
        document.getElementById('bottom-bar').style.display = 'none';
        this._vocabViewOpen = false;
        this._renderBookList();
        window.scrollTo(0, 0);
    },

    // Furigana toggle
    toggleFurigana() {
        const body = document.body;
        const isOn = body.classList.toggle('show-furigana');
        YomuStorage.saveSetting('furigana', isOn);

        // Sync checkbox and button
        const checkbox = document.getElementById('furigana-toggle');
        if (checkbox) checkbox.checked = isOn;
        const btn = document.getElementById('btn-furigana');
        if (btn) btn.classList.toggle('active', isOn);
    },

    // Font family
    setFont(font) {
        document.body.className = document.body.className
            .replace(/font-\w+/g, '').trim();
        document.body.classList.add(`font-${font}`);
        YomuStorage.saveSetting('font', font);

        // Update button states
        document.querySelectorAll('.font-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.font === font);
        });
    },

    // Font size
    setFontSize(size) {
        document.documentElement.style.setProperty('--base-font-size', size + 'px');
        YomuStorage.saveSetting('fontSize', parseInt(size));
        const display = document.getElementById('font-size-value');
        if (display) display.textContent = size + 'px';
    },

    // Line height
    setLineHeight(val) {
        const lh = (val / 10).toFixed(1);
        document.documentElement.style.setProperty('--line-height', lh);
        YomuStorage.saveSetting('lineHeight', parseFloat(lh));
        const display = document.getElementById('line-height-value');
        if (display) display.textContent = lh;
    },

    // Settings panel
    toggleSettings() {
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');

        if (this._settingsOpen) {
            panel.classList.add('hidden');
            overlay.classList.add('hidden');
            this._settingsOpen = false;
        } else {
            panel.classList.remove('hidden');
            overlay.classList.remove('hidden');
            this._settingsOpen = true;
        }
    },

    // Vocabulary popup
    closePopup() {
        document.getElementById('popup-card').classList.add('hidden');
        document.getElementById('popup-overlay').classList.add('hidden');
    },

    toggleMark() {
        const btn = document.getElementById('btn-mark-word');
        const word = btn.dataset.lemma || btn.dataset.surface;
        const reading = btn.dataset.reading;
        const meaning = btn.dataset.meaning;
        const pos = btn.dataset.pos;
        const bookId = btn.dataset.bookId;

        if (YomuStorage.isMarked(word, reading)) {
            YomuStorage.removeVocab(word, reading);
            btn.textContent = '単語帳に追加';
        } else {
            YomuStorage.addVocab(word, reading, meaning, pos, bookId);
            btn.textContent = '単語帳から削除';
        }

        // Refresh marks in reader
        YomuReader.refreshMarks();
    },

    // Vocabulary view
    showVocab() {
        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('reader-view').classList.remove('active');
        document.getElementById('vocab-view').classList.remove('hidden');
        this._vocabViewOpen = true;

        this._renderVocabList();
    },

    _renderVocabList() {
        const vocab = YomuStorage.getVocab();
        const list = document.getElementById('vocab-list');
        const empty = document.getElementById('vocab-empty');
        const count = document.getElementById('vocab-count');

        count.textContent = vocab.length + ' 語';

        if (vocab.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        let html = '';

        for (const item of vocab) {
            html += `
                <li class="vocab-item">
                    <div class="vocab-item-info">
                        <div class="vocab-item-word">${this._escapeHtml(item.word)}</div>
                        <div class="vocab-item-reading">${this._escapeHtml(item.reading)}</div>
                        ${item.meaning ? `<div class="vocab-item-meaning">${this._escapeHtml(item.meaning)}</div>` : ''}
                        ${item.pos ? `<div class="vocab-item-source">${this._escapeHtml(item.pos)}</div>` : ''}
                    </div>
                    <button onclick="Yomu.removeVocabItem('${this._escapeAttr(item.word)}', '${this._escapeAttr(item.reading)}')">削除</button>
                </li>
            `;
        }

        list.innerHTML = html;
    },

    removeVocabItem(word, reading) {
        YomuStorage.removeVocab(word, reading);
        this._renderVocabList();
        YomuReader.refreshMarks();
    },

    // Apply saved settings on init
    _applySettings() {
        const settings = YomuStorage.getSettings();

        // Font family
        if (settings.font) {
            this.setFont(settings.font);
        }

        // Font size
        if (settings.fontSize) {
            const slider = document.getElementById('font-size-slider');
            if (slider) slider.value = settings.fontSize;
            this.setFontSize(settings.fontSize);
        }

        // Line height
        if (settings.lineHeight) {
            const slider = document.getElementById('line-height-slider');
            if (slider) slider.value = settings.lineHeight * 10;
            this.setLineHeight(settings.lineHeight * 10);
        }

        // Furigana
        if (settings.furigana !== undefined) {
            if (!settings.furigana) {
                document.body.classList.remove('show-furigana');
                const checkbox = document.getElementById('furigana-toggle');
                if (checkbox) checkbox.checked = false;
                const btn = document.getElementById('btn-furigana');
                if (btn) btn.classList.remove('active');
            }
        }
    },

    _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    _escapeAttr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => Yomu.init());
