/**
 * Yomu App - Main application controller
 */
const Yomu = {
    reader: YomuReader,
    _settingsOpen: false,
    _vocabViewOpen: false,
    _storeOpen: false,
    _storeBooks: [],
    _storePage: 0,
    _pageSize: 10,
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

            // Setup history/routing handling
            window.addEventListener('popstate', (e) => this._handlePopState(e));
            window.addEventListener('hashchange', () => this._handleHashRouting());
            
            // Hide loading
            loading.classList.add('hidden');
            
            // Initial Routing (Prioritize URL Hash)
            if (!this._handleHashRouting()) {
                // Fallback to last session state if no hash
                const lastState = YomuStorage.getAppState();
                const view = lastState.lastView || 'library';
                const bookId = lastState.lastBookId;

                if (view === 'reader' && bookId) {
                    await this.openBook(bookId, false);
                } else if (view === 'vocab') {
                    this.showVocab(false);
                } else if (view === 'store') {
                    this.showStore(false);
                } else {
                    this.showBookList(false);
                }
            }
        } catch (e) {
            console.error('Init failed:', e);
            msg.textContent = '初期化に失敗しました。ページを再読み込みしてください。';
        }
    },

    _handleGlobalClick(e) {
        // 1. Handle Modal Overlay click (Click on background to cancel)
        if (e.target.id === 'modal-overlay') {
            const cancelBtn = document.getElementById('modal-cancel-btn');
            if (cancelBtn && cancelBtn.style.display !== 'none') {
                cancelBtn.click();
            } else {
                const okBtn = document.getElementById('modal-ok-btn');
                if (okBtn) okBtn.click();
            }
            return;
        }

        // 2. Handle Settings Overlay click
        if (e.target.id === 'settings-overlay' && this._settingsOpen) {
            this.toggleSettings();
            return;
        }

        if (!this._isReaderOpen) {
            return;
        }

        // Priority 1: Ignore if clicking on interactive elements
        const interactive = e.target.closest('.word-token') || 
                          e.target.closest('.bottom-bar') || 
                          e.target.closest('button') ||
                          e.target.closest('.trans-icon') ||
                          e.target.closest('.settings-panel') ||
                          e.target.closest('.modal-card');
                          
        if (interactive) {
            return;
        }

        // Priority 2: If settings panel is open, close it
        if (this._settingsOpen) {
            this.toggleSettings();
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
        
        // Update counter
        const counter = document.getElementById('library-count');
        const totalCount = bundledBooks.length + downloadedBooks.length;
        if (counter) counter.textContent = totalCount;
        
        const grid = document.getElementById('book-grid');
        let html = '';

        const renderCard = (book, isDownloaded = false) => {
            const progress = YomuStorage.getProgress(book.id);
            const percent = Math.round(progress.scrollPercent || 0);
            return `
                <div class="book-card" onclick="Yomu.openBook('${book.id}')">
                    <div class="book-info">
                        <div class="book-title">${this._escapeHtml(book.title)}</div>
                        <div class="book-author">${this._escapeHtml(book.author)}</div>
                        <div class="book-desc">${this._escapeHtml(book.desc || '')}</div>
                    </div>
                    <div class="book-meta">
                        <div class="book-progress-info">
                            ${progress.lastRead ? `<span class="book-progress">読了 ${percent}%</span>` : ''}
                            ${progress.lastRead ? `<div class="progress-bar-container"><div class="progress-bar-fill" style="width:${percent}%"></div></div>` : ''}
                        </div>
                        ${isDownloaded ? `
                            <button class="delete-btn" onclick="Yomu.deleteBook(event, '${book.id}', '${this._escapeAttr(book.title)}')">
                                削除
                            </button>
                        ` : `<div class="file-id">${book.id}</div>`}
                    </div>
                </div>
            `;
        };

        // 1. Downloaded section (Now on top)
        if (downloadedBooks.length > 0) {
            html += '<h2 class="library-section-title">ダウンロード済み</h2>';
            html += '<div class="library-section-grid">';
            for (const book of downloadedBooks) {
                html += renderCard(book, true);
            }
            html += '</div>';
        }

        // 2. Built-in section
        html += '<h2 class="library-section-title">名作選</h2>';
        html += '<div class="library-section-grid">';
        for (const book of bundledBooks) {
            html += renderCard(book);
        }
        html += '</div>';

        grid.innerHTML = html;
        grid.style.display = 'block'; // Ensure it's not a grid itself if it contains grids
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
            const state = { view: 'reader', bookId: bookId };
            history.pushState(state, '', `#book/${bookId}`);
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
            history.pushState({ view: 'library' }, '', '#library');
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

        this._storePage = 0; // Reset page when opening store
        this._renderStore();
    },

    nextStorePage() {
        const query = document.getElementById('store-search-input').value.toLowerCase();
        const filtered = this._storeBooks.filter(b => 
            b.title.toLowerCase().includes(query) || 
            b.author.toLowerCase().includes(query)
        );
        
        if ((this._storePage + 1) * this._pageSize < filtered.length) {
            this._storePage++;
            this._renderStore(query);
            window.scrollTo(0, 0);
        }
    },

    prevStorePage() {
        if (this._storePage > 0) {
            this._storePage--;
            const query = document.getElementById('store-search-input').value.toLowerCase();
            this._renderStore(query);
            window.scrollTo(0, 0);
        }
    },

    _renderStore(filter = '') {
        const grid = document.getElementById('store-grid');
        const downloaded = YomuStorage.getDownloadedBooks();
        const query = filter.toLowerCase();

        const filtered = this._storeBooks.filter(b => 
            b.title.toLowerCase().includes(query) || 
            b.author.toLowerCase().includes(query)
        );

        // Slice for pagination
        const start = this._storePage * this._pageSize;
        const paged = filtered.slice(start, start + this._pageSize);

        let html = '';
        for (const book of paged) {
            const id = book.workId || book.fileId; 
            const isDownloaded = downloaded.some(d => d.id === id);
            const authorText = book.author || `(著者ID: ${book.authorId})`;
            html += `
                <div class="book-card ${isDownloaded ? 'downloaded' : ''}" id="store-book-${id}">
                    <div class="book-info">
                        <div class="book-title">${this._escapeHtml(book.title)}</div>
                        <div class="book-author">${this._escapeHtml(authorText)}</div>
                        <div class="book-extra">
                            <span>著者ID: ${this._escapeHtml(book.authorId)}</span>
                            <span>作品ID: ${this._escapeHtml(book.workId || 'N/A')}</span>
                        </div>
                    </div>
                    <div class="book-meta">
                        <button class="download-btn ${isDownloaded ? 'downloaded' : ''}" 
                                id="btn-dl-${id}"
                                onclick="Yomu.downloadBook('${id}')">
                            ${isDownloaded ? '読む' : 'ダウンロード'}
                        </button>
                    </div>
                </div>
            `;
        }
        grid.innerHTML = html || '<div style="padding: 20px; color: #999;">作品が見つかりませんでした。</div>';

        // Update pagination buttons
        const prevBtn = document.getElementById('btn-prev-page');
        const nextBtn = document.getElementById('btn-next-page');
        if (prevBtn) prevBtn.disabled = this._storePage === 0;
        if (nextBtn) nextBtn.disabled = (this._storePage + 1) * this._pageSize >= filtered.length;
    },

    filterStore(query) {
        this._storePage = 0; // Reset to page 0 on search
        this._renderStore(query);
    },

    async downloadBook(bookId) {
        const book = this._storeBooks.find(b => (b.workId || b.fileId) === bookId);
        if (!book) return;

        // Check if already downloaded
        if (YomuStorage.getDownloadedBooks().some(d => d.id === bookId)) {
            this.openBook(bookId);
            return;
        }

        // Show Progress Dialog
        const overlay = document.getElementById('modal-overlay');
        const titleEl = document.getElementById('modal-title');
        const msgEl = document.getElementById('modal-message');
        const okBtn = document.getElementById('modal-ok-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        titleEl.textContent = 'ダウンロード';
        msgEl.innerHTML = `
            <span class="download-status-text" id="dl-status">接続中...</span>
            <div class="download-progress-container">
                <div class="download-progress-fill" id="dl-progress" style="width: 10%"></div>
            </div>
        `;
        cancelBtn.style.display = 'none';
        okBtn.style.display = 'none'; // Hide OK until done
        overlay.classList.add('active');

        const updateStatus = (text, progress) => {
            const statusEl = document.getElementById('dl-status');
            const progressEl = document.getElementById('dl-progress');
            if (statusEl) statusEl.textContent = text;
            if (progressEl) progressEl.style.width = progress + '%';
        };

        try {
            updateStatus('データを取得中...', 30);
            const processed = await YomuAozora.downloadBook(book);
            
            updateStatus('解析・保存中...', 70);
            await YomuStorage.saveBookContent(bookId, processed);
            
            // Add to downloaded list
            YomuStorage.addDownloadedBook({
                id: bookId,
                title: book.title,
                author: book.author || `(ID: ${book.authorId})`,
                desc: book.desc || '',
                year: book.year || ''
            });

            updateStatus('完了！', 100);
            msgEl.innerHTML += '<p style="margin-top:10px; font-weight:bold;">準備が整いました。</p>';
            
            okBtn.textContent = '今すぐ読む';
            okBtn.style.display = 'block';
            okBtn.onclick = () => {
                overlay.classList.remove('active');
                this.openBook(bookId);
            };

            // Refresh store in background
            setTimeout(() => this._renderStore(document.getElementById('store-search-input')?.value || ''), 100);
            
        } catch (e) {
            console.error('Download failed:', e);
            titleEl.textContent = 'エラー';
            msgEl.textContent = 'ダウンロードに失敗しました。接続を確認してください。';
            okBtn.textContent = '閉じる';
            okBtn.style.display = 'block';
            okBtn.onclick = () => overlay.classList.remove('active');
        }
    },

    // Furigana toggle
    toggleFurigana() {
        const settings = YomuStorage.getSettings();
        const currentMode = settings.furiganaMode || 'nlp';
        const nextMode = currentMode === 'none' ? 'nlp' : 'none';
        this.setFuriganaMode(nextMode);
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
        if (!await this.confirm('GitHubから最新の書籍データを取得しますか？\n（現在の読み込み中的书籍列表が更新されます）', 'データ同期')) {
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
                
                await this.alert(`同期完了！${books.length} 冊の書籍情報を取得しました。ページを再読み込みします。`, '同期成功');
                window.location.reload();
            } else {
                throw new Error('Sync failed: ' + r.status);
            }
        } catch (e) {
            console.error('Sync failed:', e);
            await this.alert('同期に失敗しました。ネットワーク连接を確認してください。', 'エラー');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    },

    // Custom Modals (Async)
    async deleteBook(event, bookId, title) {
        event.stopPropagation(); // Don't open the book
        const ok = await this.confirm(`「${title}」を削除しますか？`);
        if (ok) {
            YomuStorage.removeDownloadedBook(bookId);
            this._renderBookList();
        }
    },

    alert(message, title = '通知') {
        return new Promise(resolve => {
            const overlay = document.getElementById('modal-overlay');
            const titleEl = document.getElementById('modal-title');
            const msgEl = document.getElementById('modal-message');
            const okBtn = document.getElementById('modal-ok-btn');
            const cancelBtn = document.getElementById('modal-cancel-btn');

            titleEl.textContent = title;
            msgEl.textContent = message;
            cancelBtn.style.display = 'none';
            okBtn.onclick = () => {
                overlay.classList.remove('active');
                resolve();
            };

            overlay.classList.add('active');
        });
    },

    confirm(message, title = '確認') {
        return new Promise(resolve => {
            const overlay = document.getElementById('modal-overlay');
            const titleEl = document.getElementById('modal-title');
            const msgEl = document.getElementById('modal-message');
            const okBtn = document.getElementById('modal-ok-btn');
            const cancelBtn = document.getElementById('modal-cancel-btn');

            titleEl.textContent = title;
            msgEl.textContent = message;
            cancelBtn.style.display = 'block';
            
            okBtn.onclick = () => {
                overlay.classList.remove('active');
                resolve(true);
            };
            cancelBtn.onclick = () => {
                overlay.classList.remove('active');
                resolve(false);
            };

            overlay.classList.add('active');
        });
    },
    closePopup() {
        document.getElementById('popup-card').classList.add('hidden');
        document.getElementById('popup-overlay').classList.add('hidden');
    },

    toggleMark() {
        const btn = document.getElementById('btn-mark-word');
        const word = btn.dataset.surface;
        const reading = btn.dataset.reading;
        const meaning = btn.dataset.meaning;
        const pos = btn.dataset.pos;
        const posDetail = btn.dataset.posDetail;
        const lemma = btn.dataset.lemma;
        const bookId = btn.dataset.bookId;

        if (YomuStorage.isMarked(word, reading)) {
            YomuStorage.removeVocab(word, reading);
            btn.textContent = '単語帳に追加';
        } else {
            YomuStorage.addVocab(word, reading, meaning, pos, bookId, lemma, posDetail);
            btn.textContent = '単語帳から削除';
        }

        // Refresh marks in reader
        YomuReader.refreshMarks();
    },

    // Vocabulary view
    showVocab(pushState = true) {
        if (this._vocabViewOpen) {
            const lastState = YomuStorage.getAppState();
            if (lastState.lastBookId) {
                this.openBook(lastState.lastBookId, false);
            } else {
                this.showBookList(false);
            }
            return;
        }

        // Save current view state as 'vocab' but don't overwrite lastBookId
        YomuStorage.saveAppState({ lastView: 'vocab' });

        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('reader-view').classList.remove('active');
        document.getElementById('vocab-view').classList.remove('hidden');
        document.getElementById('store-view').classList.add('hidden');
        this._vocabViewOpen = true;
        this._isReaderOpen = false; // We are in vocab view now

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

        // Group by bookId
        const books = YomuReader.getBooks();
        const grouped = {};
        
        for (const item of vocab) {
            const bid = item.bookId || 'unknown';
            if (!grouped[bid]) grouped[bid] = [];
            grouped[bid].push(item);
        }

        let html = '';
        
        // Sort groups: show current book first, then others alphabetical
        const currentBook = YomuReader.getCurrentBook();
        const currentBookId = currentBook ? currentBook.id : null;
        
        const sortedBookIds = Object.keys(grouped).sort((a, b) => {
            if (a === currentBookId) return -1;
            if (b === currentBookId) return 1;
            if (a === 'unknown') return 1;
            if (b === 'unknown') return -1;
            return a.localeCompare(b);
        });

        for (const bid of sortedBookIds) {
            const book = books.find(b => b.id === bid);
            const bookTitle = book ? book.title : (bid === 'unknown' ? 'その他' : bid);
            
            html += `<li class="vocab-group-header">${this._escapeHtml(bookTitle)}</li>`;
            
            for (const item of grouped[bid]) {
                const lemma = item.lemma || '';
                const posDetail = item.posDetail || '';
                const displayPos = `${this._escapeHtml(item.pos || '')}${posDetail ? ` / ${this._escapeHtml(posDetail)}` : ''}`;
                const hasExtra = !!(item.meaning || (lemma && lemma !== item.word));

                html += `
                    <li class="vocab-item ${hasExtra ? 'has-detail' : ''}" onclick="${hasExtra ? 'Yomu.toggleVocabDetail(this)' : ''}">
                        <div class="vocab-item-main">
                            <div class="vocab-item-word-row">
                                <span class="vocab-item-word">${this._escapeHtml(item.word)}</span>
                                <span class="vocab-item-reading">【${this._escapeHtml(item.reading)}】</span>
                                <span class="vocab-item-pos">${displayPos}</span>
                            </div>
                            <button class="vocab-delete-btn" onclick="event.stopPropagation(); Yomu.removeVocabItem('${this._escapeAttr(item.word)}', '${this._escapeAttr(item.reading)}')">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        ${hasExtra ? `
                        <div class="vocab-item-detail">
                            ${lemma && lemma !== item.word ? `<div class="vocab-detail-row"><strong>原形:</strong> ${this._escapeHtml(lemma)}</div>` : ''}
                            ${item.meaning ? `<div class="vocab-detail-meaning">${this._escapeHtml(item.meaning)}</div>` : ''}
                        </div>
                        ` : ''}
                    </li>
                `;
            }
        }

        list.innerHTML = html;
    },

    removeVocabItem(word, reading) {
        YomuStorage.removeVocab(word, reading);
        this._renderVocabList();
        // Also refresh marks if reader is active in background
        if (this.reader) this.reader.refreshMarks();
    },

    toggleVocabDetail(el) {
        el.classList.toggle('expanded');
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

        // Furigana Mode
        const furiMode = settings.furiganaMode || 'nlp';
        const furiSelect = document.getElementById('furigana-mode-select');
        if (furiSelect) furiSelect.value = furiMode;
        
        document.body.classList.toggle('show-furigana', furiMode !== 'none');
        
        const animStyle = document.getElementById('animation-style');
        // Animation
        const noAnimToggle = document.getElementById('no-animation-toggle');
        const noAnim = settings.noAnimation === true;
        if (noAnimToggle) noAnimToggle.checked = noAnim;
        
        if (animStyle) animStyle.disabled = noAnim;

        // Sync bottom bar button
        const btn = document.getElementById('btn-furigana');
        if (btn) btn.classList.toggle('active', furiMode !== 'none');
    },

    setFuriganaMode(mode) {
        YomuStorage.saveSetting('furiganaMode', mode);
        this._applySettings();
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
        // If state is present, use it
        if (e.state) {
            this._routeByState(e.state);
        } else {
            // Otherwise fallback to hash
            this._handleHashRouting();
        }
    },

    _handleHashRouting() {
        const hash = window.location.hash;
        if (!hash) return false;

        if (hash === '#library') {
            this.showBookList(false);
            return true;
        }
        if (hash === '#store') {
            this.showStore(false);
            return true;
        }
        if (hash === '#vocab') {
            this.showVocab(false);
            return true;
        }
        if (hash.startsWith('#book/')) {
            const bookId = hash.replace('#book/', '');
            if (bookId) {
                this.openBook(bookId, false);
                return true;
            }
        }
        return false;
    },

    _routeByState(state) {
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
