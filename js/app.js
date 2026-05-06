/**
 * Yomu App - Main application controller
 */
const Yomu = {
    reader: YomuReader,
    _settingsOpen: false,
    _storeOpen: false,
    _storeBooks: [],
    _storePage: 0,
    _storeCatalogLoaded: false,
    _storeCatalogLoading: false,
    _storeFilters: {
        author: '',
        category: '',
        orthography: ''
    },
    _homePage: 0,
    _homeFilters: {
        category: '',
        translation: ''
    },
    _pageSize: 10,
    _adaptivePageSize: 10,
    _isReaderOpen: false,
    _readerControlsVisible: false,
    _bookInfoCardOpen: false,
    _localVersion: null,

    async init() {
        window.addEventListener('resize', () => {
            if (!this._isReaderOpen) {
                this._calculatePageSize();
                this._renderBookList();
                if (this._storeOpen) this._renderStore();
            }
        });
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
            // Environment detection: Android (E-ink) vs Web
            const isAndroid = /Android/i.test(navigator.userAgent);
            document.body.classList.add(isAndroid ? 'env-android' : 'env-web');
            console.log('Environment:', isAndroid ? 'Android (E-ink Mode)' : 'Web (Animated Mode)');

            // Step 0: Version
            try { this._localVersion = await this._fetchLocalJson('data/version.json'); } catch (e) {}

            // Step 1: Storage
            msg.textContent = 'ストレージを初期化中...';
            try { await YomuStorage.init(); } catch (e) { console.error('Storage init failed:', e); }

            // Step 2: Tokenizer
            msg.textContent = '形態素解析器を初期化中...';
            try { await YomuTokenizer.init(); } catch (e) { console.error('Tokenizer init failed:', e); }

            // Step 4: Reader
            msg.textContent = '書籍リストを読み込み中...';
            try { await YomuReader.init(); } catch (e) { console.error('Reader init failed:', e); }

            // Step 5: Settings & UI
            msg.textContent = 'UIを準備中...';
            this._applySettings();
            this._updateNlpOptionState();
            this._renderBookList();

            // Setup history/routing handling
            window.addEventListener('popstate', (e) => this._handlePopState(e));
            window.addEventListener('hashchange', () => this._handleHashRouting());

            // Hide loading
            loading.classList.add('hidden');

            // --- History & Routing Fix ---
            const initialHash = window.location.hash;
            const initialState = history.state;

            // Ensure there's always a library state at the bottom of the stack
            if (!initialState) {
                history.replaceState({ view: 'library' }, '', '#library');
            }

            let routed = false;
            // 1. Priority: URL Hash (Deep linking)
            if (initialHash && initialHash !== '#library') {
                if (initialHash.startsWith('#book/')) {
                    const bookId = initialHash.replace('#book/', '');
                    this.openBook(bookId, true);
                    routed = true;
                } else if (initialHash === '#store') {
                    this.showStore(true);
                    routed = true;
                }
            }

            // 2. Secondary: Resuming last session
            if (!routed) {
                const state = YomuStorage.getAppState();
                if (state.lastView === 'reader' && state.lastBookId) {
                    console.log('[App] Resuming last book:', state.lastBookId);
                    this.openBook(state.lastBookId, true);
                } else if (state.lastView === 'store') {
                    this.showStore(true);
                } else {
                    this.showBookList(false);
                }
            }
        } catch (e) {
            console.error('Fatal Init Error:', e);
            msg.textContent = '初期化に失敗しました。';
            const btn = document.createElement('button');
            btn.textContent = '再読み込み';
            btn.className = 'modal-btn primary';
            btn.style.marginTop = '20px';
            btn.onclick = () => window.location.reload();
            msg.appendChild(document.createElement('br'));
            msg.appendChild(btn);
        }
    },

    _handleGlobalClick(e) {
        // 1. Handle Modal Overlay click (Click on background to cancel)
        if (e.target.id === 'modal-overlay') {
            const cancelBtn = document.getElementById('modal-cancel-btn');
            if (cancelBtn && !cancelBtn.classList.contains('hidden')) {
                cancelBtn.click();
            } else {
                const okBtn = document.getElementById('modal-ok-btn');
                if (okBtn) okBtn.click();
            }
            return;
        }

        if (!this._isReaderOpen) {
            return;
        }

        this.updateReaderControlsAvailability();

        const interactive = e.target.closest('.word-token') ||
            e.target.closest('button') ||
            e.target.closest('a') ||
            e.target.closest('input, select, textarea, label') ||
            e.target.closest('.trans-icon') ||
            e.target.closest('.settings-panel') ||
            e.target.closest('.settings-overlay') ||
            e.target.closest('.modal-card') ||
            e.target.closest('.book-info-card') ||
            e.target.closest('.reader-status-bar') ||
            e.target.closest('.reader-back-btn');

        if (!interactive && document.body.classList.contains('reader-controls-available')) {
            this.setReaderControlsVisible(!this._readerControlsVisible);
            if (this._bookInfoCardOpen) this.setBookInfoCardVisible(false);
        } else if (!e.target.closest('.book-info-card') && !e.target.closest('.status-left')) {
            // Clicked something else interactive, close card if it was open
            if (this._bookInfoCardOpen) this.setBookInfoCardVisible(false);
        }
    },

    toggleSettingsFromButton(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this.toggleSettings();
    },

    setReaderControlsVisible(visible) {
        this._readerControlsVisible = Boolean(visible);
        document.body.classList.toggle('reader-controls-visible', this._readerControlsVisible);
    },

    updateReaderControlsAvailability() {
        if (!this._isReaderOpen) {
            document.body.classList.remove('reader-controls-available');
            this.setReaderControlsVisible(false);
            return;
        }

        document.body.classList.add('reader-controls-available');
    },

    toggleBookInfoCard(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this.setBookInfoCardVisible(!this._bookInfoCardOpen);
    },

    setBookInfoCardVisible(visible) {
        this._bookInfoCardOpen = Boolean(visible);
        const card = document.getElementById('book-info-card');
        if (card) {
            card.classList.toggle('active', this._bookInfoCardOpen);
            if (this._bookInfoCardOpen) {
                // Update card content from current book
                const book = YomuReader.getCurrentBook();
                const bookData = YomuReader.getCurrentBookData();

                if (book) {
                    const titleEl = document.getElementById('card-title');
                    const authorEl = document.getElementById('card-author');
                    if (titleEl) titleEl.textContent = book.title;
                    if (authorEl) authorEl.textContent = book.author;

                    // Metadata Population
                    const metadataEl = document.getElementById('card-metadata');
                    if (metadataEl && bookData) {
                        const info = bookData.aozora_info || {};
                        const authors = info.authors || [];
                        const author = authors[0] || {};
                        const baseBook = info.baseBook1 || {};

                        const rows = [];
                        const addRow = (label, value) => {
                            if (!value) return;
                            rows.push(`
                                <div class="frontmatter-row">
                                    <div class="frontmatter-label">${this._escapeHtml(label)}</div>
                                    <div class="frontmatter-value">${this._escapeHtml(value)}</div>
                                </div>
                            `);
                        };

                        addRow('作品読み', info.titleKana);
                        addRow('分類', info.ndc);
                        addRow('文字遣い', info.orthography);
                        addRow('初出', info.firstAppearance);
                        addRow('公開日', info.publishedAt);
                        addRow('最終更新', info.updatedAt);
                        addRow('著者読み', [author.kana, author.roman].filter(Boolean).join(' / '));
                        addRow('生没年', [author.birthDate, author.deathDate].filter(Boolean).join(' - '));
                        addRow('底本', baseBook.title);
                        addRow('出版社', baseBook.publisher);
                        addRow('底本初版', baseBook.firstPublishedAt);
                        addRow('入力・校正', [info.inputBy, info.proofreadBy].filter(Boolean).join(' / '));

                        metadataEl.innerHTML = rows.join('');
                        metadataEl.style.display = rows.length > 0 ? 'grid' : 'none';

                        // Card Footer (External Link)
                        const footerEl = document.getElementById('card-footer');
                        if (footerEl) {
                            footerEl.innerHTML = info.cardUrl
                                ? `<a class="frontmatter-link" href="${this._escapeAttr(info.cardUrl)}" target="_blank" rel="noopener noreferrer">青空文庫 図書カード</a>`
                                : '';
                        }
                    }
                }
            }
        }
    },

    _handleGlobalKey(e) {
        // Handle keys globally (for both Reader and Library/Store)
        const key = e.key || e.code || '';
        const isDown = key === 'AudioVolumeDown' || key === 'VolumeDown' || key === 'PageDown' || key === ' ';
        const isUp = key === 'AudioVolumeUp' || key === 'VolumeUp' || key === 'PageUp';

        if (this._isReaderOpen) {
            if (isDown) {
                e.preventDefault();
                this._scrollReader(1);
            } else if (isUp) {
                e.preventDefault();
                this._scrollReader(-1);
            }
        } else {
            // Library or Store view pagination
            if (isDown) {
                e.preventDefault();
                if (this._storeOpen) this.nextStorePage();
                else this.nextHomePage();
            } else if (isUp) {
                e.preventDefault();
                if (this._storeOpen) this.prevStorePage();
                else this.prevHomePage();
            }
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
        this._calculatePageSize();
        const allBooks = this._getLibraryBooks();
        const filtered = this._getFilteredLibraryBooks(allBooks);

        // Update counter (Total books in library)
        const counter = document.getElementById('library-count');
        if (counter) counter.textContent = allBooks.length;
        this._renderHomeFilters(allBooks, filtered.length);

        const grid = document.getElementById('book-grid');
        let html = '';

        const renderCard = (book) => {
            const progress = YomuStorage.getProgress(book.id);
            const percent = Math.round(progress.scrollPercent || 0);
            return `
                <div class="book-card" onclick="Yomu.openBook('${book.id}')">
                    <div class="book-info">
                        <div class="book-title-row">
                            <span class="book-title">${this._escapeHtml(book.title)}</span>
                            ${book.hasTrans ? '<span class="badge-e">訳</span>' : ''}
                            <span class="book-title-sep">·</span>
                            <span class="book-author">${this._escapeHtml(book.author)}</span>
                        </div>
                        <div class="book-desc">${this._escapeHtml(book.desc || '')}</div>
                    </div>
                    ${progress.lastRead ? `
                    <div class="book-progress-row">
                        <div class="progress-bar-container"><div class="progress-bar-fill" style="--progress-width:${percent}%"></div></div>
                        <span class="book-progress">${percent}%</span>
                    </div>
                    ` : ''}
                    <div class="book-card-bottom">
                        <div class="book-tags">
                            ${this._renderTag(this._categoryLabel(this._bookCategory(book)))}
                        </div>
                        ${book.isDownloaded ? `
                            <button class="delete-btn-icon" onclick="Yomu.deleteBook(event, '${book.id}', '${this._escapeAttr(book.title)}')" title="削除">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        };

        // Paging
        const pageSize = this._adaptivePageSize;
        const totalPages = Math.ceil(filtered.length / pageSize) || 1;
        if (this._homePage >= totalPages) this._homePage = totalPages - 1;
        if (this._homePage < 0) this._homePage = 0;

        const start = this._homePage * pageSize;
        const paged = filtered.slice(start, start + pageSize);

        for (const book of paged) {
            html += renderCard(book);
        }

        grid.innerHTML = html || '<div class="empty-msg">条件に合う作品がありません。</div>';

        // Update pagination UI
        const pageInfo = document.getElementById('home-page-info');
        if (pageInfo) pageInfo.textContent = `${this._homePage + 1} / ${totalPages}`;

        const prevBtnHeader = document.getElementById('btn-home-prev-header');
        const nextBtnHeader = document.getElementById('btn-home-next-header');
        if (prevBtnHeader) prevBtnHeader.disabled = this._homePage === 0;
        if (nextBtnHeader) nextBtnHeader.disabled = (this._homePage + 1) * pageSize >= filtered.length;
    },

    _calculatePageSize() {
        const grid = document.getElementById('book-grid');
        if (!grid) return;

        const containerHeight = grid.clientHeight;
        if (containerHeight <= 0) {
            this._adaptivePageSize = 8;
            grid.style.setProperty('--grid-rows', 4);
            return;
        }

        const gap = 20;
        const minRowHeight = 170;
        const maxRows = Math.floor((containerHeight + gap) / (minRowHeight + gap));
        const rows = Math.max(1, Math.min(maxRows, 6));

        grid.style.setProperty('--grid-rows', rows);
        this._adaptivePageSize = rows * 2;
    },

    nextHomePage() {
        const total = this._getFilteredLibraryBooks().length;
        const totalPages = Math.ceil(total / this._adaptivePageSize);

        if (this._homePage + 1 < totalPages) {
            this._homePage++;
            this._renderBookList();
            window.scrollTo({ top: 0, behavior: 'auto' });
        }
    },

    prevHomePage() {
        if (this._homePage > 0) {
            this._homePage--;
            this._renderBookList();
            window.scrollTo({ top: 0, behavior: 'auto' });
        }
    },

    setHomeFilter(type, value) {
        if (!Object.prototype.hasOwnProperty.call(this._homeFilters, type)) return;
        this._homeFilters[type] = value;
        this._homePage = 0;
        this._renderBookList();
        window.scrollTo({ top: 0, behavior: 'auto' });
    },

    _getLibraryBooks() {
        const bundledBooks = YomuReader.getBooks();
        const downloadedBooks = YomuStorage.getDownloadedBooks();
        const allBooks = [];

        for (const b of downloadedBooks) allBooks.push({ ...b, isDownloaded: true });
        for (const b of bundledBooks) {
            if (!downloadedBooks.some(d => d.id === b.id)) {
                allBooks.push({ ...b, isDownloaded: false });
            }
        }

        return allBooks;
    },

    _getFilteredLibraryBooks(allBooks = null) {
        const books = (allBooks || this._getLibraryBooks()).filter(book => {
            if (this._homeFilters.category && this._bookCategory(book) !== this._homeFilters.category) return false;
            if (this._homeFilters.translation === 'translated' && !book.hasTrans) return false;
            if (this._homeFilters.translation === 'untranslated' && book.hasTrans) return false;
            return true;
        });

        // Sort by last read timestamp
        return books.sort((a, b) => {
            const progA = YomuStorage.getProgress(a.id);
            const progB = YomuStorage.getProgress(b.id);
            const timeA = progA.lastRead || 0;
            const timeB = progB.lastRead || 0;
            return timeB - timeA;
        });
    },

    _renderHomeFilters(allBooks, resultCount) {
        const chipBox = document.getElementById('home-filter-chips');
        if (chipBox) {
            const counts = new Map();
            for (const book of allBooks) {
                const cat = this._bookCategory(book);
                if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
            }

            const cats = [
                { id: 'fiction', label: '小説' },
                { id: 'children', label: '児童文学' },
                { id: 'essay', label: '随筆・記録' },
                { id: 'poetry', label: '詩歌' },
                { id: 'drama', label: '戯曲' },
                { id: 'foreign', label: '海外文学' }
            ].filter(c => counts.get(c.id) > 0);

            chipBox.innerHTML = `
                ${this._homeFilterButton('category', '', 'すべて', allBooks.length)}
                ${cats.map(c => this._homeFilterButton('category', c.id, c.label, counts.get(c.id))).join('')}
            `;
        }

        const transSelect = document.getElementById('home-translation-select');
        if (transSelect) {
            transSelect.value = this._homeFilters.translation || '';
        }

        const summary = document.getElementById('home-filter-summary');
        if (summary) {
            const active = [
                this._categoryLabel(this._homeFilters.category),
                this._homeFilters.translation === 'translated' ? '翻訳あり' : '',
                this._homeFilters.translation === 'untranslated' ? '原文のみ' : ''
            ].filter(Boolean);
            summary.textContent = `${resultCount} 冊${active.length ? ' · ' + active.join(' / ') : ''}`;
        }
    },

    _homeFilterButton(type, value, label, count = null) {
        const active = this._homeFilters[type] === value ? ' active' : '';
        const action = `Yomu.setHomeFilter(${JSON.stringify(type)}, ${JSON.stringify(value)})`;
        const countHtml = count !== null ? `<span class="chip-count">${count}</span>` : '';
        return `<button class="filter-chip${active}" data-home-filter-type="${this._escapeAttr(type)}" data-home-filter-value="${this._escapeAttr(value)}" onclick="${this._escapeAttr(action)}"><span class="chip-label">${this._escapeHtml(label)}</span>${countHtml}</button>`;
    },

    async openBook(bookId, pushState = true) {
        const success = await YomuReader.openBook(bookId);
        if (!success) {
            console.warn(`Book ${bookId} not found or failed to load. Returning to library.`);
            this.showBookList();
            return;
        }

        this._isReaderOpen = true;
        // 隐藏其他视图，只显示阅读器
        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('store-view').classList.add('hidden');
        document.getElementById('reader-view').classList.add('active');
        document.documentElement.classList.add('reader-active');
        document.body.classList.add('reader-active');
        this._storeOpen = false;
        this.updateReaderControlsAvailability();

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
        document.documentElement.classList.remove('reader-active');
        document.body.classList.remove('reader-active');
        document.body.classList.remove('reader-controls-available');
        this.setReaderControlsVisible(false);
        this.setBookInfoCardVisible(false);

        document.getElementById('store-view').classList.add('hidden');
        document.getElementById('book-list-view').classList.remove('hidden');

        // Update shared header
        const storeBtn = document.getElementById('btn-show-store');
        const libBtn = document.getElementById('btn-show-library');
        const mainTitle = document.getElementById('main-title');
        if (storeBtn) storeBtn.classList.remove('hidden');
        if (libBtn) libBtn.classList.add('hidden');
        if (mainTitle) mainTitle.textContent = '読書器';

        this._storeOpen = false;
        this._isReaderOpen = false;

        if (pushState) {
            // Only push if we aren't already on library hash to avoid duplicates
            if (window.location.hash !== '#library') {
                history.pushState({ view: 'library' }, '', '#library');
            } else {
                history.replaceState({ view: 'library' }, '', '#library');
            }
        }

        this._renderBookList();
        window.scrollTo({ top: 0, behavior: 'auto' });
    },

    back() {
        if (this._settingsOpen) {
            this.toggleSettings();
            return;
        }
        if (this._bookInfoCardOpen) {
            this.setBookInfoCardVisible(false);
            return;
        }
        
        // If we are in reader or store, we want to go back
        if (this._isReaderOpen || this._storeOpen) {
            // Check if we have history to go back to
            if (window.history.length > 1) {
                window.history.back();
            } else {
                // Fallback if no history (should not happen with our init fix)
                this.showBookList(true);
            }
        } else {
            // Already in library, let Android handle it (it will exit)
            // Or we could trigger a confirmation toast "Press again to exit"
            // For now, do nothing and let native handle hardware back
        }
    },

    // ===== Store (Online Library) =====
    async showStore(pushState = true) {
        YomuStorage.saveAppState({ lastView: 'store', lastBookId: null });

        document.getElementById('reader-view').classList.remove('active');
        document.body.classList.remove('reader-active');
        document.body.classList.remove('reader-controls-available');
        this.setReaderControlsVisible(false);
        this.setBookInfoCardVisible(false);

        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('store-view').classList.remove('hidden');
        this._storeOpen = true;

        // Update shared header
        const storeBtn = document.getElementById('btn-show-store');
        const libBtn = document.getElementById('btn-show-library');
        const mainTitle = document.getElementById('main-title');
        if (storeBtn) storeBtn.classList.add('hidden');
        if (libBtn) libBtn.classList.remove('hidden');
        if (mainTitle) mainTitle.textContent = '書庫';

        if (pushState) {
            if (window.location.hash !== '#store') {
                history.pushState({ view: 'store' }, '', '#store');
            }
        }

        if (this._storeBooks.length === 0) {
            await this._loadStorePreviewCatalog();
        }

        this._storePage = 0; // Reset page when opening store
        this._renderStore();
        this._loadFullStoreCatalog();
    },

    async _loadStorePreviewCatalog() {
        try {
            const data = await this._fetchLocalJson('data/aozora_catalog_preview.json');
            this._storeBooks = data || [];
        } catch (e) {
            console.error('Failed to load store preview catalog:', e);
            this._storeBooks = [];
        }
    },

    async _loadFullStoreCatalog() {
        if (this._storeCatalogLoaded || this._storeCatalogLoading) return;
        this._storeCatalogLoading = true;
        this._renderStoreFilters(this._getFilteredStoreBooks(document.getElementById('store-search-input')?.value || '').length);

        try {
            const data = await this._fetchLocalJson('data/aozora_catalog_compact.json');
            if (data) {
                this._storeBooks = data;
                this._storeCatalogLoaded = true;
                this._storePage = 0;
                this._renderStore(document.getElementById('store-search-input')?.value || '');
            }
        } catch (e) {
            console.error('Failed to load full store catalog:', e);
        } finally {
            this._storeCatalogLoading = false;
        }
    },

    /**
     * Helper to fetch local JSON using XHR (more reliable than fetch on Android file://)
     */
    _fetchLocalJson(path) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', path + '?t=' + Date.now(), true);
            xhr.onload = () => {
                if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`XHR failed with status ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('XHR Network Error'));
            xhr.send();
        });
    },

    nextStorePage() {
        const query = document.getElementById('store-search-input').value.toLowerCase();
        const filtered = this._getFilteredStoreBooks(query);

        if ((this._storePage + 1) * this._pageSize < filtered.length) {
            this._storePage++;
            this._renderStore(query);
            window.scrollTo({ top: 0, behavior: 'auto' });
        }
    },

    prevStorePage() {
        if (this._storePage > 0) {
            this._storePage--;
            const query = document.getElementById('store-search-input').value.toLowerCase();
            this._renderStore(query);
            window.scrollTo({ top: 0, behavior: 'auto' });
        }
    },

    _renderStore(filter = '') {
        const grid = document.getElementById('store-grid');
        const downloaded = YomuStorage.getDownloadedBooks();
        const query = filter.toLowerCase();

        const filtered = this._getFilteredStoreBooks(query);
        this._renderStoreFilters(filtered.length);

        // Slice for pagination
        const start = this._storePage * this._pageSize;
        const paged = filtered.slice(start, start + this._pageSize);

        let html = '';
        for (const book of paged) {
            const id = book.fileId || book.workId;
            const isDownloaded = downloaded.some(d => d.id === id);
            const authorText = book.author || `(著者ID: ${book.authorId})`;
            html += `
                <div class="book-card ${isDownloaded ? 'downloaded' : ''}" id="store-book-${id}">
                    <div class="book-info">
                        <div class="book-title">
                            ${this._escapeHtml(book.title)}
                            ${book.hasTrans ? '<span class="badge-e">訳</span>' : ''}
                        </div>
                        <div class="book-author">${this._escapeHtml(authorText)}</div>
                        <div class="book-tags">
                            ${this._renderTag(this._categoryLabel(this._bookCategory(book)))}
                            ${book.baseBook ? this._renderTag(`底本: ${book.baseBook}`) : ''}
                        </div>
                    </div>
                    <div class="book-meta">
                        <button class="download-btn ${isDownloaded ? 'downloaded' : ''}"
                                id="btn-dl-${id}"
                                onclick="${isDownloaded ? `Yomu.openBook('${id}')` : `Yomu.downloadBook('${id}')`}">
                            ${isDownloaded ? '読む' : 'オフライン保存'}
                        </button>
                    </div>
                </div>
            `;
        }
        grid.innerHTML = html || '<div class="empty-msg">作品が見つかりませんでした。</div>';

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

    setStoreFilter(type, value) {
        if (!Object.prototype.hasOwnProperty.call(this._storeFilters, type)) return;
        this._storeFilters[type] = value;
        this._storePage = 0;
        this._renderStore(document.getElementById('store-search-input')?.value || '');
    },

    _getFilteredStoreBooks(query = '') {
        const q = (query || '').trim().toLowerCase();
        const seen = new Set();

        return this._storeBooks.filter(book => {
            const key = `${book.title}|${book.author}|${book.authorId}`;
            if (seen.has(key)) return false;
            seen.add(key);

            if (q && !this._storeSearchText(book).includes(q)) return false;
            if (this._storeFilters.author && book.author !== this._storeFilters.author) return false;
            if (this._storeFilters.category && this._bookCategory(book) !== this._storeFilters.category) return false;
            if (this._storeFilters.orthography && book.orthography !== this._storeFilters.orthography) return false;
            return true;
        });
    },

    _storeSearchText(book) {
        return [
            book.title,
            book.titleKana,
            book.author,
            book.authorKana,
            book.authorRoman,
            book.authorId,
            book.workId,
            book.fileId,
            book.ndc,
            book.orthography,
            book.baseBook,
            book.baseBookTitle,
            book.desc
        ].filter(Boolean).join(' ').toLowerCase();
    },

    _renderStoreFilters(resultCount) {
        // 1. Authors
        const authorBox = document.getElementById('filter-authors');
        if (authorBox) {
            const counts = new Map();
            for (const book of this._storeBooks) {
                if (!book.author) continue;
                counts.set(book.author, (counts.get(book.author) || 0) + 1);
            }
            const authors = Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .slice(0, 12);
            authorBox.innerHTML = `
                <div class="filter-label">著者</div>
                <div class="filter-chips-group">
                    ${this._filterButton('author', '', 'すべて')}
                    ${authors.map(([author, count]) => this._filterButton('author', author, author, count)).join('')}
                </div>
            `;
        }

        // 2. Categories
        const catBox = document.getElementById('filter-categories');
        if (catBox) {
            const counts = new Map();
            for (const book of this._storeBooks) {
                const cat = this._bookCategory(book);
                if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
            }
            const cats = [
                { id: 'fiction', label: '小説' },
                { id: 'children', label: '児童文学' },
                { id: 'essay', label: '随筆・記録' },
                { id: 'poetry', label: '詩歌' },
                { id: 'drama', label: '戯曲' },
                { id: 'foreign', label: '海外文学' }
            ];
            catBox.innerHTML = `
                <div class="filter-label">分類</div>
                <div class="filter-chips-group">
                    ${this._filterButton('category', '', 'すべて')}
                    ${cats.map(c => this._filterButton('category', c.id, c.label, counts.get(c.id) || 0)).join('')}
                </div>
            `;
        }

        // 3. Orthographies
        const orthBox = document.getElementById('filter-orthographies');
        if (orthBox) {
            const counts = new Map();
            for (const book of this._storeBooks) {
                if (book.orthography) counts.set(book.orthography, (counts.get(book.orthography) || 0) + 1);
            }
            const orths = ['新字新仮名', '新字旧仮名', '旧字旧仮名'];
            orthBox.innerHTML = `
                <div class="filter-label">文字遣い</div>
                <div class="filter-chips-group">
                    ${this._filterButton('orthography', '', 'すべて')}
                    ${orths.map(o => this._filterButton('orthography', o, o, counts.get(o) || 0)).join('')}
                </div>
            `;
        }

        document.querySelectorAll('.filter-chip').forEach(btn => {
            const type = btn.dataset.filterType;
            const value = btn.dataset.filterValue || '';
            btn.classList.toggle('active', this._storeFilters[type] === value);
        });

        const summary = document.getElementById('store-filter-summary');
        if (summary) {
            const active = [
                this._storeFilters.author,
                this._categoryLabel(this._storeFilters.category),
                this._storeFilters.orthography
            ].filter(Boolean);
            const loading = this._storeCatalogLoading && !this._storeCatalogLoaded ? ' · 全書庫を読み込み中' : '';
            summary.textContent = `${resultCount} 件${active.length ? ' · ' + active.join(' / ') : ''}${loading}`;
        }
    },

    _filterButton(type, value, label, count = null) {
        const active = this._storeFilters[type] === value ? ' active' : '';
        const action = `Yomu.setStoreFilter(${JSON.stringify(type)}, ${JSON.stringify(value)})`;
        const countHtml = count !== null ? `<span class="chip-count">${count}</span>` : '';
        return `<button class="filter-chip${active}" data-filter-type="${this._escapeAttr(type)}" data-filter-value="${this._escapeAttr(value)}" onclick="${this._escapeAttr(action)}"><span class="chip-label">${this._escapeHtml(label)}</span>${countHtml}</button>`;
    },

    _bookCategory(book) {
        const ndc = book.ndc || '';
        if (/NDC\s*K/.test(ndc)) return 'children';
        if (/NDC\s*913/.test(ndc)) return 'fiction';
        if (/NDC\s*911/.test(ndc)) return 'poetry';
        if (/NDC\s*912/.test(ndc)) return 'drama';
        if (/NDC\s*91[456]/.test(ndc)) return 'essay';
        if (/NDC\s*9[2-9]/.test(ndc)) return 'foreign';

        const id = book.id || book.fileId || '';
        const title = book.title || '';
        if (['gingatetsudo', 'kumo_no_ito', 'yodaka_no_hoshi', 'chumon_ryori', 'yuki_onna'].includes(id)) {
            return 'children';
        }
        if (id === 'gakumon_no_susume') return 'essay';
        if (title) return 'fiction';
        return '';
    },

    _categoryLabel(category) {
        return {
            fiction: '小説',
            children: '児童文学',
            essay: '随筆・記録',
            poetry: '詩歌',
            drama: '戯曲',
            foreign: '海外文学'
        }[category] || '';
    },

    _renderTag(label) {
        return label ? `<span class="book-tag">${this._escapeHtml(label)}</span>` : '';
    },

    async downloadBook(bookId) {
        const book = this._storeBooks.find(b => (b.fileId || b.workId) === bookId);
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

        titleEl.textContent = '本棚に追加';
        msgEl.innerHTML = `
            <span class="download-status-text" id="dl-status">接続中...</span>
            <div class="download-progress-container">
                <div class="download-progress-fill" id="dl-progress" style="--progress-width: 10%"></div>
            </div>
        `;
        cancelBtn.classList.add('hidden');
        okBtn.classList.add('hidden'); // Hide OK until done
        overlay.classList.add('active');

        const updateStatus = (text, progress) => {
            const statusEl = document.getElementById('dl-status');
            const progressEl = document.getElementById('dl-progress');
            if (statusEl) statusEl.textContent = text;
            if (progressEl) progressEl.style.setProperty('--progress-width', progress + '%');
        };

        try {
            updateStatus(window.YomuNative ? '作品データをダウンロード中...' : '作品データを読み込み中...', 30);
            const processed = await YomuAozora.downloadBook(book);
            if (processed && !processed.aozora_info) {
                processed.aozora_info = this._catalogBookToAozoraInfo(book);
            }

            updateStatus('解析・保存中...', 70);
            await YomuStorage.saveBookContent(bookId, processed);

            // Add to downloaded list
            YomuStorage.addDownloadedBook({
                id: bookId,
                title: book.title,
                author: book.author || `(ID: ${book.authorId})`,
                desc: book.desc || '',
                year: book.year || '',
                ndc: book.ndc || '',
                baseBook: book.baseBook || '',
                orthography: book.orthography || ''
            });

            updateStatus('完了！', 100);
            msgEl.innerHTML += '<p class="u-margin-top-20 u-font-weight-bold">本棚に追加しました。</p>';

            okBtn.textContent = '今すぐ読む';
            okBtn.classList.remove('hidden');
            okBtn.onclick = () => {
                overlay.classList.remove('active');
                this.openBook(bookId);
            };

            // Refresh store in background
            setTimeout(() => this._renderStore(document.getElementById('store-search-input')?.value || ''), 100);

        } catch (e) {
            console.error('Download failed:', e);
            titleEl.textContent = 'エラー';
            msgEl.textContent = '本棚への追加に失敗しました。接続を確認してください。';
            okBtn.textContent = '閉じる';
            okBtn.classList.remove('hidden');
            okBtn.onclick = () => overlay.classList.remove('active');
        }
    },

    _catalogBookToAozoraInfo(book) {
        return {
            workId: book.workId || '',
            title: book.title || '',
            titleKana: book.titleKana || '',
            ndc: book.ndc || '',
            orthography: book.orthography || '',
            publishedAt: book.publishedAt || '',
            cardUrl: book.cardUrl || '',
            textFileId: book.fileId || '',
            author: book.author || '',
            authors: [{
                personId: book.authorId || '',
                name: book.author || '',
                kana: book.authorKana || '',
                roman: book.authorRoman || '',
                role: '著者'
            }],
            baseBook1: {
                title: book.baseBookTitle || '',
                publisher: book.baseBook || ''
            },
            source: 'aozora_catalog'
        };
    },

    // Furigana toggle
    toggleFurigana() {
        const settings = YomuStorage.getSettings();
        const currentMode = settings.furiganaMode || 'none';
        const nextMode = currentMode === 'none' ? 'internal' : 'none';
        this.setFuriganaMode(nextMode);
    },

    // Font family
    setFont(font) {
        document.body.classList.remove('font-mincho', 'font-gothic');

        const content = document.getElementById('novel-content');
        if (content) {
            content.classList.remove('font-mincho', 'font-gothic');
            content.classList.add(`font-${font}`);
        }

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
            this._updateNlpOptionState();
            this._fetchVersion();
        }
    },

    _fetchVersion() {
        const el = document.getElementById('settings-version');
        if (!el) return;

        const settings = YomuStorage.getSettings();
        const ver = settings.version || this._localVersion;

        if (ver) {
            el.textContent = `${ver.sha} (${ver.date})`;
        } else {
            el.textContent = 'v1.0.0';
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
            cancelBtn.classList.add('hidden');
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
            cancelBtn.classList.remove('hidden');

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
        let furiMode = settings.furiganaMode || 'none';
        if (furiMode === 'nlp' && !YomuTokenizer.isDictAvailable()) {
            furiMode = 'internal';
            YomuStorage.saveSetting('furiganaMode', furiMode);
        }
        const furiSelect = document.getElementById('furigana-mode-select');
        if (furiSelect) furiSelect.value = furiMode;

        document.body.classList.toggle('show-furigana', furiMode !== 'none');
    },

    setFuriganaMode(mode) {
        if (mode === 'nlp' && !YomuTokenizer.isDictAvailable()) {
            // Revert selection temporarily to avoid showing empty results
            const settings = YomuStorage.getSettings();
            const furiSelect = document.getElementById('furigana-mode-select');
            if (furiSelect) furiSelect.value = settings.furiganaMode || 'internal';

            this.promptDictDownload(false);
            return;
        }
        YomuStorage.saveSetting('furiganaMode', mode);
        this._applySettings();
        if (this._isReaderOpen && this.reader.getCurrentBook()) {
            this.reader.reRender();
        }
    },

    _updateNlpOptionState() {
        const furiSelect = document.getElementById('furigana-mode-select');
        if (!furiSelect) return;

        const nlpOption = furiSelect.querySelector('option[value="nlp"]');
        if (nlpOption) {
            const dictReady = YomuTokenizer.isDictAvailable();
            nlpOption.disabled = false;
            nlpOption.style.display = '';
            nlpOption.textContent = dictReady ? 'Kuromoji.js' : 'Kuromoji.js（未ダウンロード）';
        }
    },

    async promptDictDownload(isAuto = false) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('modal-overlay');
            const titleEl = document.getElementById('modal-title');
            const msgEl = document.getElementById('modal-message');
            const okBtn = document.getElementById('modal-ok-btn');
            const cancelBtn = document.getElementById('modal-cancel-btn');

            titleEl.textContent = '辞書ダウンロード';

            if (isAuto) {
                msgEl.innerHTML = `
                    <p>形態素解析エンジン「Kuromoji」の辞書データが未ダウンロードです。</p>
                    <p style="text-align:left; font-size:13px; line-height:1.6; margin-top:10px; color:#444;">
                        このデータをダウンロードすることで、アプリ内のすべての単語に正確なふりがなを表示し、分かち書き（ワードラップ）の精度を向上させることができます。
                    </p>
                    <p class="dict-progress-info">約18MB / Wi-Fi環境推奨</p>
                    <span class="download-status-text" id="dict-dl-status"></span>
                    <div class="download-progress-container hidden" id="dict-dl-progress-wrap">
                        <div class="download-progress-fill" id="dict-dl-progress" style="--progress-width:0%"></div>
                    </div>
                `;
            } else {
                msgEl.innerHTML = `
                    <p>ふりがな表示に必要な Kuromoji 辞書をダウンロードしますか？</p>
                    <p class="dict-progress-info">約18MB / Wi-Fi推奨</p>
                    <span class="download-status-text" id="dict-dl-status"></span>
                    <div class="download-progress-container hidden" id="dict-dl-progress-wrap">
                        <div class="download-progress-fill" id="dict-dl-progress" style="--progress-width:0%"></div>
                    </div>
                `;
            }

            okBtn.textContent = 'ダウンロード';
            okBtn.classList.remove('hidden');
            cancelBtn.textContent = isAuto ? '後で' : 'キャンセル';
            cancelBtn.classList.remove('hidden');
            overlay.classList.add('active');

            const cleanup = () => {
                overlay.classList.remove('active');
                okBtn.textContent = 'OK';
                cancelBtn.textContent = 'キャンセル';
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve();
            };

            okBtn.onclick = () => {
                okBtn.classList.add('hidden');
                cancelBtn.classList.add('hidden');

                const statusEl = document.getElementById('dict-dl-status');
                const progressWrap = document.getElementById('dict-dl-progress-wrap');
                const progressEl = document.getElementById('dict-dl-progress');
                if (progressWrap) progressWrap.classList.remove('hidden');
                if (statusEl) statusEl.textContent = 'ダウンロード中...';

                YomuTokenizer.downloadDict(
                    (overallProgress, filename, fileProgress) => {
                        if (statusEl) statusEl.textContent = `ダウンロード中... (${overallProgress}%)`;
                        if (progressEl) progressEl.style.setProperty('--progress-width', overallProgress + '%');
                    },
                    async (successCount, totalCount) => {
                        if (successCount === totalCount) {
                            if (statusEl) statusEl.textContent = '設定を更新中...';
                            await YomuTokenizer.reinit();

                            // Auto-switch to NLP mode
                            YomuStorage.saveSetting('furiganaMode', 'nlp');

                            if (statusEl) statusEl.textContent = '完了！アプリを再起動します...';

                            // Force reload after a short delay
                            setTimeout(() => {
                                window.location.hash = ''; // Return to library for clean start
                                window.location.reload();
                            }, 1500);
                        } else {
                            if (statusEl) statusEl.textContent = `一部のファイルのダウンロードに失敗しました (${successCount}/${totalCount})`;
                            okBtn.textContent = '再試行';
                            okBtn.classList.remove('hidden');
                            cancelBtn.textContent = '閉じる';
                            cancelBtn.classList.remove('hidden');
                            cancelBtn.onclick = () => { cleanup(); resolve(); };
                        }
                    },
                    (filename, error) => {
                        console.error(`Download error for ${filename}: ${error}`);
                    }
                );
            };
        });
    },

    async clearAllData() {
        const overlay = document.getElementById('modal-overlay');
        const titleEl = document.getElementById('modal-title');
        const msgEl = document.getElementById('modal-message');
        const okBtn = document.getElementById('modal-ok-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        titleEl.textContent = 'データの全削除';
        msgEl.innerHTML = 'すべての設定、読書履歴、ダウンロードした本、および辞書データを削除しますか？<br><br><span class="u-color-error">※この操作は取り消せません。</span>';

        okBtn.textContent = '削除する';
        okBtn.classList.remove('hidden');
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.classList.remove('hidden');
        overlay.classList.add('active');

        okBtn.onclick = async () => {
            okBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            msgEl.textContent = '削除中...';

            try {
                await YomuStorage.clearAllData();
                YomuTokenizer._ready = false;
                YomuTokenizer._tokenizer = null;
                YomuTokenizer._dictPath = null;
                document.body.classList.remove('show-furigana');
                msgEl.textContent = '削除完了。アプリを再起動します。';
                setTimeout(() => {
                    window.location.hash = '';
                    window.location.reload();
                }, 1500);
            } catch (e) {
                console.error('Clear failed:', e);
                msgEl.textContent = '削除に失败しました。';
                cancelBtn.classList.remove('hidden');
                cancelBtn.textContent = '閉じる';
                cancelBtn.onclick = () => overlay.classList.remove('active');
            }
        };

        cancelBtn.onclick = () => {
            overlay.classList.remove('active');
        };
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

window.Yomu = Yomu;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => Yomu.init());
