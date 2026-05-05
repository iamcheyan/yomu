/**
 * Yomu App - Main application controller
 */
const Yomu = {
    reader: YomuReader,
    _settingsOpen: false,
    _vocabViewOpen: false,
    _storeOpen: false,
    _storeBooks: [],
    _isReaderOpen: false,

    async init() {
        document.addEventListener('keydown', (e) => this._handleGlobalKey(e));
        document.addEventListener('volumekey', (e) => {
            if (e.detail && e.detail.direction) {
                this._scrollReader(e.detail.direction === 'down' ? 1 : -1);
            }
        });
        document.addEventListener('click', (e) => this._handleGlobalClick(e));

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

            // Setup history handling
            window.addEventListener('popstate', (e) => this._handlePopState(e));
            
            // Initial state
            if (!history.state) {
                history.replaceState({ view: 'library' }, '');
            }

            // Hide loading
            loading.classList.add('hidden');
            
            // Initial view state (Restore from last session)
            const lastState = YomuStorage.getAppState();
            if (lastState.lastView === 'reader' && lastState.lastBookId) {
                this.openBook(lastState.lastBookId, false);
            } else if (lastState.lastView === 'vocab') {
                this.showVocab(false);
            } else if (lastState.lastView === 'store') {
                this.showStore(false);
            } else {
                this.showBookList(false);
            }
        } catch (e) {
            console.error('Init failed:', e);
            msg.textContent = '初期化に失敗しました。ページを再読み込みしてください。';
        }
    },

    _handleGlobalClick(e) {
        if (!this._isReaderOpen) return;

        // Priority 1: If settings panel is open, click outside to close it
        if (this._settingsOpen) {
            if (!e.target.closest('.settings-panel')) {
                this.toggleSettings();
            }
            return; // Don't do anything else while settings are open
        }

        // Priority 2: Ignore if clicking on interactive elements
        if (e.target.closest('.word-token') || 
            e.target.closest('.bottom-bar') || 
            e.target.closest('button') ||
            e.target.closest('.trans-icon')) {
            return;
        }

        // Priority 3: Toggle bottom bar
        this.toggleBottomBar();
    },

    toggleBottomBar() {
        const bar = document.getElementById('bottom-bar');
        if (bar) {
            bar.classList.toggle('hidden');
        }
    },

    _handleGlobalKey(e) {
        if (!this._isReaderOpen) return;

        const key = e.key || e.code || '';
        if (key === 'AudioVolumeDown' || key === 'VolumeDown' || key === 'PageDown' || key === ' ') {
            e.preventDefault();
            this._scrollReader(1);
        } else if (key === 'AudioVolumeUp' || key === 'VolumeUp' || key === 'PageUp') {
            e.preventDefault();
            this._scrollReader(-1);
        }
    },

    _scrollReader(direction) {
        const amount = window.innerHeight * 0.85; // Leave 15% overlap for reading continuity
        window.scrollBy({
            top: direction * amount,
            behavior: 'auto' // E-ink friendly: instant jump
        });
    },

    _renderBookList() {
        const bundledBooks = YomuReader.getBooks();
        const downloadedBooks = YomuStorage.getDownloadedBooks();
        
        // Merge and deduplicate by ID (downloaded takes precedence)
        const booksMap = new Map();
        bundledBooks.forEach(b => booksMap.set(b.id, b));
        downloadedBooks.forEach(b => booksMap.set(b.id, b));
        
        const books = Array.from(booksMap.values());
        
        // Update counter
        const counter = document.getElementById('library-count');
        if (counter) counter.textContent = books.length;
        
        const grid = document.getElementById('book-grid');
        let html = '';

        for (const book of books) {
            const progress = YomuStorage.getProgress(book.id);
            const percent = Math.round(progress.scrollPercent || 0);

            html += `
                <div class="book-card" onclick="Yomu.openBook('${book.id}')">
                    <div class="book-info">
                        <div class="book-title">
                            ${this._escapeHtml(book.title)}
                        </div>
                        <div class="book-author">${this._escapeHtml(book.author)}</div>
                        <div class="book-desc">${this._escapeHtml(book.desc || '')}</div>
                    </div>
                    
                    <div class="book-meta">
                        <div class="book-progress-info">
                            ${progress.lastRead ? `<span class="book-progress">読了 ${percent}%</span>` : ''}
                            ${progress.lastRead ? `<div class="progress-bar-container"><div class="progress-bar-fill" style="width:${percent}%"></div></div>` : ''}
                        </div>
                        <div class="file-id">${book.id}.json</div>
                    </div>
                </div>
            `;
        }

        grid.innerHTML = html;
    },

    async openBook(bookId, pushState = true) {
        await YomuReader.openBook(bookId);
        this._isReaderOpen = true;
        document.body.classList.add('reader-active');
        // Keep bottom bar hidden by default in reader
        document.getElementById('bottom-bar').classList.add('hidden');
        
        // Save app state
        YomuStorage.saveAppState({ lastView: 'reader', lastBookId: bookId });

        if (pushState) {
            history.pushState({ view: 'reader', bookId: bookId }, '');
        }
    },

    showBookList(pushState = true) {
        // Save current scroll position before leaving
        YomuStorage.saveAppState({ lastView: 'library', lastBookId: null });
        
        document.getElementById('reader-view').classList.remove('active');
        document.body.classList.remove('reader-active');
        
        document.getElementById('vocab-view').classList.add('hidden');
        document.getElementById('store-view').classList.add('hidden');
        document.getElementById('book-list-view').classList.remove('hidden');
        
        // Show bottom bar but handle its internal visibility via CSS
        document.getElementById('bottom-bar').classList.remove('hidden');
        
        this._vocabViewOpen = false;
        this._storeOpen = false;
        this._isReaderOpen = false;
        
        if (pushState) {
            history.pushState({ view: 'library' }, '');
        }
        
        this._renderBookList();
        window.scrollTo(0, 0);
    },

    // ===== Store (Online Library) =====
    async showStore(pushState = true) {
        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('store-view').classList.remove('hidden');
        this._storeOpen = true;
        
        if (pushState) {
            history.pushState({ view: 'store' }, '');
        }

        if (this._storeBooks.length === 0) {
            try {
                const resp = await fetch('data/aozora_catalog.json');
                this._storeBooks = await resp.json();
            } catch (e) {
                console.error('Failed to load store catalog:', e);
            }
        }

        this._renderStore();
    },

    _renderStore(filter = '') {
        const grid = document.getElementById('store-grid');
        const downloaded = YomuStorage.getDownloadedBooks();
        const query = filter.toLowerCase();

        const filtered = this._storeBooks.filter(b => 
            b.title.toLowerCase().includes(query) || 
            b.author.toLowerCase().includes(query)
        );

        let html = '';
        for (const book of filtered) {
            const isDownloaded = downloaded.some(d => d.id === book.id);
            html += `
                <div class="book-card ${isDownloaded ? 'downloaded' : ''}" id="store-book-${book.id}" onclick="Yomu.downloadBook('${book.id}')">
                    <div class="book-info">
                        <div class="book-title">${this._escapeHtml(book.title)}</div>
                        <div class="book-author">${this._escapeHtml(book.author)}</div>
                        <div class="book-desc">${this._escapeHtml(book.desc || '')}</div>
                    </div>
                    <div class="book-meta">
                        ${isDownloaded ? '取得済み' : 'ダウンロード'}
                    </div>
                </div>
            `;
        }
        grid.innerHTML = html || '<div style="padding: 20px; color: #999;">作品が見つかりませんでした。</div>';
    },

    filterStore(query) {
        this._renderStore(query);
    },

    async downloadBook(bookId) {
        const book = this._storeBooks.find(b => b.id === bookId);
        if (!book) return;

        // Check if already downloaded
        if (YomuStorage.getDownloadedBooks().some(d => d.id === bookId)) {
            // Already have it, just open it
            this.openBook(bookId);
            return;
        }

        const el = document.getElementById(`store-book-${bookId}`);
        el.classList.add('downloading');

        try {
            const processed = await YomuAozora.downloadBook(book);
            await YomuStorage.saveBookContent(bookId, processed);
            
            // Add to downloaded list
            YomuStorage.addDownloadedBook({
                id: book.id,
                title: book.title,
                author: book.author,
                desc: book.desc,
                year: book.year
            });

            el.classList.remove('downloading');
            el.classList.add('downloaded');
            
            // Re-render store to show checkmark
            this._renderStore(document.getElementById('store-search-input').value);
            
            alert(`「${book.title}」をダウンロードしました。`);
        } catch (e) {
            el.classList.remove('downloading');
            console.error('Download failed:', e);
            alert('ダウンロードに失敗しました。ネットワーク接続を確認してください。');
        }
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

    adjustFontSize(delta) {
        const slider = document.getElementById('font-size-slider');
        if (!slider) return;
        const newVal = parseInt(slider.value) + delta;
        if (newVal >= parseInt(slider.min) && newVal <= parseInt(slider.max)) {
            slider.value = newVal;
            this.setFontSize(newVal);
        }
    },

    // Line height
    setLineHeight(val) {
        const lh = (val / 10).toFixed(1);
        document.documentElement.style.setProperty('--line-height', lh);
        YomuStorage.saveSetting('lineHeight', parseFloat(lh));
        const display = document.getElementById('line-height-value');
        if (display) display.textContent = lh;
    },

    adjustLineHeight(delta) {
        const slider = document.getElementById('line-height-slider');
        if (!slider) return;
        const newVal = parseInt(slider.value) + delta;
        if (newVal >= parseInt(slider.min) && newVal <= parseInt(slider.max)) {
            slider.value = newVal;
            this.setLineHeight(newVal);
        }
    },

    // Settings panel
    toggleSettings() {
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');

        if (this._settingsOpen) {
            panel.classList.remove('open');
            overlay.classList.remove('active');
            this._settingsOpen = false;
        } else {
            panel.classList.add('open');
            overlay.classList.add('active');
            this._settingsOpen = true;
            this._fetchVersion();
        }
    },

    _fetchVersion() {
        const el = document.getElementById('settings-version');
        if (!el) return;
        
        // Fetch latest commit hash from GitHub
        fetch('https://api.github.com/repos/iamcheyan/yomu/commits/main')
            .then(r => r.json())
            .then(data => {
                if (data.sha) {
                    const short = data.sha.substring(0, 7);
                    const date = (data.commit?.committer?.date || '').substring(0, 10);
                    el.textContent = `${short} (${date})`;
                }
            })
            .catch(() => {
                el.textContent = 'v1.0.0';
            });
    },

    async syncData() {
        if (!confirm('GitHubから最新の書籍データを取得しますか？\n（現在の読み込み中的书籍列表が更新されます）')) {
            return;
        }

        const btn = document.querySelector('button[onclick="Yomu.syncData()"]');
        const originalText = btn.textContent;
        btn.textContent = '同期中...';
        btn.disabled = true;

        try {
            const url = 'https://raw.githubusercontent.com/iamcheyan/yomu/main/data/books.json';
            const r = await fetch(url + '?t=' + Date.now());
            if (r.ok) {
                const books = await r.json();
                // Save to storage
                YomuStorage.saveSetting('syncedBooks', books);
                
                alert(`同期完了！${books.length} 冊の書籍情報を取得しました。ページを再読み込みします。`);
                window.location.reload();
            } else {
                throw new Error('Sync failed: ' + r.status);
            }
        } catch (e) {
            console.error('Sync failed:', e);
            alert('同期に失敗しました。ネットワーク连接を確認してください。');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
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
    showVocab(pushState = true) {
        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('reader-view').classList.remove('active');
        document.getElementById('vocab-view').classList.remove('hidden');
        this._vocabViewOpen = true;

        if (pushState) {
            history.pushState({ view: 'vocab' }, '');
        }

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

        // Animation (E-ink optimization)
        const noAnimToggle = document.getElementById('no-animation-toggle');
        const noAnim = settings.noAnimation === true;
        if (noAnimToggle) noAnimToggle.checked = noAnim;
        
        const animStyle = document.getElementById('animation-style');
        if (animStyle) animStyle.disabled = noAnim;

        // Auto Furigana
        const autoFuriToggle = document.getElementById('auto-furigana-toggle');
        const autoFuri = settings.autoFurigana === true;
        if (autoFuriToggle) autoFuriToggle.checked = autoFuri;
    },

    updateAutoFuriganaSetting() {
        const checkbox = document.getElementById('auto-furigana-toggle');
        const autoFuri = checkbox ? checkbox.checked : false;
        
        YomuStorage.saveSetting('autoFurigana', autoFuri);
        
        // Trigger re-render if reader is open
        if (this._isReaderOpen && this.reader.getCurrentBook()) {
            this.reader.reRender();
        }
    },

    updateAnimationSetting() {
        const checkbox = document.getElementById('no-animation-toggle');
        const noAnim = checkbox ? checkbox.checked : false;
        
        const animStyle = document.getElementById('animation-style');
        if (animStyle) animStyle.disabled = noAnim;
        
        YomuStorage.saveSetting('noAnimation', noAnim);
    },

    _handlePopState(e) {
        const state = e.state;
        if (!state) return;

        switch (state.view) {
            case 'library':
                this.showBookList(false);
                break;
            case 'reader':
                this.openBook(state.bookId, false);
                break;
            case 'store':
                this.showStore(false);
                break;
            case 'vocab':
                this.showVocab(false);
                break;
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
