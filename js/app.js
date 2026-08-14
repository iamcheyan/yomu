/**
 * Yomu App - Main application controller
 *
 * 2026 redesign: 無框编辑部式首页/书库；阅读器为连续纵向文档。
 * 功能全部保留：搜索/下载/长按菜单/下拉刷新/全文検索/书库筛选/
 * 排序/统计/备份/AI 等。移除：vertical-reading、边缘翻页、2段組、
 * 首页视口分页（改为全量编辑部列表）。
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
    _homeSearch: '',
    _homeFilters: {
        category: ''
    },
    _storePageCount: 10,
    _storeFilterPanelOpen: false,
    _tocOpen: false,
    _isReaderOpen: false,
    _readerControlsVisible: false,
    _readerControlsTimeout: null,
    _bookInfoCardOpen: false,
    _localVersion: null,

    async init() {
        document.addEventListener('keydown', (e) => this._handleGlobalKey(e));
        document.addEventListener('volumekey', (e) => {
            if (e.detail && e.detail.direction) {
                this._scrollReader(e.detail.direction === 'down' ? 1 : -1);
            }
        });
        document.addEventListener('click', (e) => this._handleGlobalClick(e));

        this._initSearchInputs();
        this._initMobileUX();
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
            if (window.YomuStats) { try { YomuStats.init(); } catch (e) { console.error('Stats init failed:', e); } }

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
            e.target.closest('.reader-topbar') ||
            e.target.closest('.reader-bottombar') ||
            e.target.closest('.toc-panel') ||
            e.target.closest('.dict-popup');

        if (!interactive && document.body.classList.contains('reader-controls-available')) {
            this.setReaderControlsVisible(!this._readerControlsVisible);
            if (this._bookInfoCardOpen) this.setBookInfoCardVisible(false);
        } else {
            // If user interacts with something else while controls are visible, reset the timer
            if (this._readerControlsVisible) {
                this.setReaderControlsVisible(true);
            }
            if (!e.target.closest('.book-info-card') && !e.target.closest('.bar-title')) {
                // Clicked something else interactive, close card if it was open
                if (this._bookInfoCardOpen) this.setBookInfoCardVisible(false);
            }
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
        if (this._readerControlsTimeout) {
            clearTimeout(this._readerControlsTimeout);
            this._readerControlsTimeout = null;
        }

        this._readerControlsVisible = Boolean(visible);
        document.body.classList.toggle('reader-controls-visible', this._readerControlsVisible);

        if (this._readerControlsVisible) {
            this._readerControlsTimeout = setTimeout(() => {
                this.setReaderControlsVisible(false);
            }, 5000);
        }
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
            // Library or Store view: volume keys page the lists
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

    /** 纵向滚动一屏（E-ink 友好瞬时跳转） */
    _scrollReader(direction) {
        const amount = window.innerHeight * 0.85; // Leave 15% overlap for reading continuity
        window.scrollBy({
            top: direction * amount,
            behavior: 'auto'
        });

        // Reset auto-hide timer if controls are visible during scroll
        if (this._readerControlsVisible) {
            this.setReaderControlsVisible(true);
        }
    },

    // ===== ホーム（書架） =====
    _renderBookList() {
        const allBooks = this._getLibraryBooks();
        const filtered = this._getFilteredLibraryBooks(allBooks);

        // Update counter (Total books in library)
        const counter = document.getElementById('library-count');
        if (counter) counter.textContent = allBooks.length;
        this._renderHomeFilters(allBooks, filtered.length);
        this._renderContinueRail(allBooks);
        this._renderHomeStats();

        const grid = document.getElementById('book-grid');
        let html = '';

        const renderRow = (book) => {
            const progress = YomuStorage.getProgress(book.id);
            const percent = Math.round(progress.scrollPercent || 0);
            return `
                <div class="book-row" data-book-id="${this._escapeAttr(book.id)}" data-book-source="library" onclick="Yomu.openBook('${this._escapeAttr(book.id)}')">
                    <div class="book-row-main">
                        <div class="book-row-title-line">
                            <span class="book-row-title">${this._escapeHtml(book.title)}</span>
                            ${this._isNewBook(book.id) ? '<span class="badge-new">新着</span>' : ''}
                            ${book.hasTrans ? '<span class="dot-e" title="翻訳あり">訳</span>' : ''}
                        </div>
                        <div class="book-row-author">${this._escapeHtml(book.author || '')}</div>
                        ${book.desc ? `<div class="book-row-desc">${this._escapeHtml(book.desc)}</div>` : ''}
                        ${progress.lastRead ? `
                        <div class="book-row-progress">
                            <div class="track"><span style="width:${percent}%"></span></div>
                            <span class="pct">${percent >= 100 ? '読了' : percent + '%'}</span>
                        </div>
                        ` : ''}
                    </div>
                    <button class="row-more-btn" onclick="Yomu.openBookMenu('${this._escapeAttr(book.id)}', 'library', event)" title="詳細メニュー" aria-label="詳細メニュー">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle></svg>
                    </button>
                </div>
            `;
        };

        for (const book of filtered) {
            html += renderRow(book);
        }

        // C3: 全文一致（标题/作者结果之后）
        if (this._fullTextResults && this._fullTextResults.size > 0) {
            const shown = new Set(filtered.map(b => b.id));
            const ftHtml = [];
            for (const [id, r] of this._fullTextResults) {
                if (shown.has(id)) continue;
                const book = r.book;
                ftHtml.push(`
                    <div class="book-row" onclick="Yomu.openBook('${this._escapeAttr(book.id)}', true, ${r.hit.paraIndex})">
                        <div class="book-row-main">
                            <div class="book-row-title-line">
                                <span class="book-row-title">${this._escapeHtml(book.title)}</span>
                                <span class="match-tag">本文一致</span>
                            </div>
                            <div class="book-row-author">${this._escapeHtml(book.author || '')}</div>
                            <div class="fulltext-excerpt">${this._escapeHtml(r.hit.excerpt)}</div>
                        </div>
                    </div>
                `);
            }
            if (ftHtml.length > 0) {
                html += `<div class="fulltext-section-label">本文検索の結果</div>` + ftHtml.join('');
            }
        }

        const hasQuery = Boolean(this._homeSearch && this._homeSearch.trim()) || Boolean(this._homeFilters.category);
        if (!html) {
            html = `
                <div class="empty-state">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <p>条件に合う作品がありません</p>
                    ${hasQuery ? '<button class="text-action-btn" onclick="Yomu.clearHomeFilters()">絞り込みをクリア</button>' : ''}
                </div>
            `;
        }
        grid.innerHTML = html;
    },

    /** 続きを読む（最近阅读的横向区域） */
    _renderContinueRail(allBooks) {
        const section = document.getElementById('home-continue-section');
        const rail = document.getElementById('continue-rail');
        if (!section || !rail) return;

        const reading = allBooks
            .map(b => ({ book: b, p: YomuStorage.getProgress(b.id) }))
            .filter(x => x.p && x.p.lastRead)
            .sort((a, b) => (b.p.lastRead || 0) - (a.p.lastRead || 0))
            .slice(0, 6);

        section.classList.toggle('hidden', reading.length === 0);

        rail.innerHTML = reading.map(({ book, p }) => {
            const percent = Math.round(p.scrollPercent || 0);
            return `
                <button class="continue-item" onclick="Yomu.openBook('${this._escapeAttr(book.id)}')">
                    <div class="continue-title">${this._escapeHtml(book.title)}</div>
                    <div class="continue-author">${this._escapeHtml(book.author || '')}</div>
                    <div class="mini-progress">
                        <div class="track"><span style="width:${percent}%"></span></div>
                        <span class="pct">${percent >= 100 ? '読了' : percent + '%'}</span>
                    </div>
                </button>
            `;
        }).join('');
    },

    _renderHomeStats() {
        const el = document.getElementById('home-stats-content');
        if (!el || !window.YomuStats) return;
        const t = YomuStats.totals();
        const streak = YomuStats.streak();
        el.innerHTML = `
            連続 <strong>${streak}</strong> 日　·　累計 <strong>${t.minutes}</strong> 分<br>
            読了 <strong>${t.chars.toLocaleString()}</strong> 字
        `;
    },

    _initSearchInputs() {
        const debounce = (fn, wait) => {
            let timer = null;
            return (...args) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn(...args), wait);
            };
        };

        const storeInput = document.getElementById('store-search-input');
        if (storeInput) {
            storeInput.addEventListener('input', debounce(() => {
                if (this._storeOpen) this.filterStore(storeInput.value);
            }, 220));
        }

        const homeInput = document.getElementById('home-search-input');
        if (homeInput) {
            homeInput.addEventListener('input', debounce(() => {
                this._homeSearch = homeInput.value;
                this._renderBookList();
                // C3: 全文検索（本地范围、异步追加，不阻塞标题/作者结果）
                if (this._homeSearch && this._homeSearch.trim().length >= 2) {
                    const q = this._homeSearch;
                    clearTimeout(this._fullTextTimer);
                    this._fullTextTimer = setTimeout(() => {
                        if (this._homeSearch === q) this._runLibrarySearch(q);
                    }, 350);
                } else {
                    this._fullTextResults = null;
                    const statusEl = document.getElementById('home-fulltext-status');
                    if (statusEl) statusEl.textContent = '';
                    this._renderBookList();
                }
            }, 220));
        }
    },

    /** 首页翻页（音量键等）：改为滚动一屏 */
    nextHomePage() {
        window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'auto' });
    },

    prevHomePage() {
        window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'auto' });
    },

    setHomeFilter(type, value) {
        if (!Object.prototype.hasOwnProperty.call(this._homeFilters, type)) return;
        this._homeFilters[type] = value;
        this._renderBookList();
        window.scrollTo({ top: 0, behavior: 'auto' });
    },

    clearHomeFilters() {
        this._homeSearch = '';
        this._homeFilters.category = '';
        this._fullTextResults = null;
        const input = document.getElementById('home-search-input');
        if (input) input.value = '';
        const statusEl = document.getElementById('home-fulltext-status');
        if (statusEl) statusEl.textContent = '';
        this._renderBookList();
    },

    _getLibraryBooks() {
        const bundledBooks = YomuReader.getBooks();
        const downloadedBooks = YomuStorage.getDownloadedBooks();
        const downloadedIds = new Set(downloadedBooks.map(d => d.id));
        const allBooks = [];

        // Migrate reading progress recorded under legacy slug ids onto the
        // canonical fileId ids (D-03).
        for (const b of bundledBooks) {
            if (!b.aliases) continue;
            for (const alias of b.aliases) {
                const legacy = YomuStorage.getProgress(alias);
                if (legacy && legacy.lastRead && !YomuStorage.getProgress(b.id).lastRead) {
                    YomuStorage.saveProgress(b.id, legacy.scrollPercent, legacy.scrollTop, legacy.paraIndex);
                }
            }
        }

        for (const b of downloadedBooks) allBooks.push({ ...b, isDownloaded: true });
        for (const b of bundledBooks) {
            if (!downloadedIds.has(b.id)) {
                // C1: ローカル导入书（source=local）可删除
                allBooks.push({ ...b, isDownloaded: b.source === 'local' });
            }
        }

        return allBooks;
    },

    // ===== C3: 書架内全文検索（本地范围、查询时扫描、零额外存储） =====
    // 范围评估见 docs/fulltext-search-notes.md：全部 11,041 本建索引 ≈560MB 原文，
    // 设备不可用；故只对「本地已有内容」的书做查询时子串扫描。

    async _fullTextSearch(q) {
        const query = (q || '').trim().toLowerCase();
        if (query.length < 2) return [];

        // 候选 = 下载 + 导入 + 精选书单（其内容 data/novels/*.json 可按需取）
        const seen = new Set();
        const candidates = [];
        for (const b of YomuStorage.getDownloadedBooks()) {
            if (!seen.has(b.id)) { seen.add(b.id); candidates.push(b); }
        }
        const settings = YomuStorage.getSettings();
        for (const b of (settings.syncedBooks || [])) {
            if (!seen.has(b.id)) { seen.add(b.id); candidates.push(b); }
        }
        for (const b of YomuReader.getBooks()) {
            if (!seen.has(b.id)) { seen.add(b.id); candidates.push(b); }
        }

        const results = [];
        for (const book of candidates) {
            if (results.length >= 12) break;
            let content = await YomuStorage.getBookContent(book.fileId || book.id);
            if (!content) {
                content = await new Promise((resolve) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', `data/novels/${book.fileId || book.id}.json`, true);
                    xhr.onload = () => {
                        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                            try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve(null); }
                        } else resolve(null);
                    };
                    xhr.onerror = () => resolve(null);
                    xhr.send();
                }).catch(() => null);
            }
            if (!content) continue;

            // 展平为与 reader 相同的全局段落序（章标题占一位）
            const paras = [];
            if (Array.isArray(content.chapters)) {
                for (const ch of content.chapters) {
                    paras.push(ch.title || '');
                    for (const p of (ch.paragraphs || [])) paras.push(p);
                }
            } else if (Array.isArray(content.paragraphs)) {
                paras.push(...content.paragraphs);
            }

            const hits = [];
            for (let i = 0; i < paras.length && hits.length < 2; i++) {
                const text = String(paras[i] || '');
                const at = text.toLowerCase().indexOf(query);
                if (at >= 0) {
                    const from = Math.max(0, at - 12);
                    hits.push({
                        paraIndex: i,
                        excerpt: (from > 0 ? '…' : '') + text.slice(from, at + query.length + 18) + '…'
                    });
                }
            }
            if (hits.length > 0) {
                results.push({ book, hit: hits[0], hits });
            }
        }
        return results;
    },

    async _runLibrarySearch(q) {
        const results = await this._fullTextSearch(q);
        this._fullTextResults = new Map(results.map(r => [r.book.id, r]));
        this._renderBookList();
        const tag = document.getElementById('home-fulltext-status');
        if (tag) {
            tag.textContent = results.length > 0
                ? `本文一致：${results.length} 件（タップで該当段落へ）`
                : '';
        }
    },

    _getFilteredLibraryBooks(allBooks = null) {
        const q = (this._homeSearch || '').trim().toLowerCase();
        const books = (allBooks || this._getLibraryBooks()).filter(book => {
            if (this._homeFilters.category && this._bookCategory(book) !== this._homeFilters.category) return false;
            return true;
        });

        const lastRead = (b) => YomuStorage.getProgress(b.id).lastRead || 0;

        if (!q) {
            // Sort by last read timestamp
            return books.sort((a, b) => lastRead(b) - lastRead(a));
        }

        // Relevance search (A2): same tiers as the store; within a tier the
        // recently-read book wins. Library records have no kana fields.
        const scored = [];
        for (let i = 0; i < books.length; i++) {
            const book = books[i];
            const rec = {
                title: (book.title || '').toLowerCase(),
                titleKana: '',
                author: (book.author || '').toLowerCase(),
                authorKana: '',
                authorRoman: '',
                other: (book.desc || '').toLowerCase()
            };
            const match = this._matchBook(rec, q);
            if (!match) continue;
            scored.push({ book, tier: match.tier, lr: lastRead(book) });
        }
        scored.sort((a, b) => a.tier - b.tier || b.lr - a.lr);
        return scored.map(s => s.book);
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

        const summary = document.getElementById('home-filter-summary');
        if (summary) {
            const active = [
                this._categoryLabel(this._homeFilters.category)
            ].filter(Boolean);
            summary.textContent = `${resultCount} 冊${this._homeSearch ? ` · 「${this._homeSearch}」` : ''}${active.length ? ' · ' + active.join(' / ') : ''}`;
        }
    },

    _homeFilterButton(type, value, label, count = null) {
        const active = this._homeFilters[type] === value ? ' active' : '';
        const action = `Yomu.setHomeFilter(${JSON.stringify(type)}, ${JSON.stringify(value)})`;
        const countHtml = count !== null ? `<span class="chip-count">${count}</span>` : '';
        return `<button class="filter-chip${active}" data-home-filter-type="${this._escapeAttr(type)}" data-home-filter-value="${this._escapeAttr(value)}" onclick="${this._escapeAttr(action)}"><span class="chip-label">${this._escapeHtml(label)}</span>${countHtml}</button>`;
    },

    async openBook(bookId, pushState = true, jumpPara = null) {
        // C3: 全文検索跳转 — 在 reader.openBook 消费（优先于保存进度）
        if (typeof jumpPara === 'number') YomuReader._pendingJump = jumpPara;
        const success = await YomuReader.openBook(bookId);
        if (!success) {
            console.warn(`Book ${bookId} not found or failed to load. Returning to library.`);
            this.showBookList();
            return;
        }

        this._isReaderOpen = true;
        if (window.YomuStats) YomuStats.setReading(true);
        this._consumeNewBadge(bookId);
        // 隐藏其他视图，只显示阅读器
        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('store-view').classList.add('hidden');
        document.getElementById('reader-view').classList.add('active');
        document.documentElement.classList.add('reader-active');
        document.body.classList.add('reader-active');
        this._storeOpen = false;
        this.updateReaderControlsAvailability();
        document.body.classList.remove('reader-immersive');
        const immersiveBtn = document.getElementById('immersive-toggle-btn');
        if (immersiveBtn) immersiveBtn.classList.remove('active');

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
        document.body.classList.remove('reader-immersive', 'past-scroll-depth');

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
        if (window.YomuStats) YomuStats.setReading(false);

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

    // ===== Store (Online Library) =====
    async showStore(pushState = true) {
        YomuStorage.saveAppState({ lastView: 'store', lastBookId: null });

        document.getElementById('reader-view').classList.remove('active');
        document.body.classList.remove('reader-active');
        document.body.classList.remove('reader-controls-available');
        this.setReaderControlsVisible(false);
        this.setBookInfoCardVisible(false);
        document.body.classList.remove('reader-immersive', 'past-scroll-depth');

        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('store-view').classList.remove('hidden');
        this._storeOpen = true;
        if (window.YomuStats) YomuStats.setReading(false);

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
            this._renderStoreSkeleton();
            await this._loadStorePreviewCatalog();
        }

        // Keep the browsing position when returning to the store (U-03);
        // page resets happen on search/filter changes instead.
        this._renderStore();
        this._loadFullStoreCatalog();
    },

    /** 目录加载骨架（低对比 shimmer） */
    _renderStoreSkeleton() {
        const grid = document.getElementById('store-grid');
        if (!grid) return;
        grid.className = 'store-listing list-mode';
        let html = '';
        for (let i = 0; i < 6; i++) {
            html += `
                <div class="skeleton-row" aria-hidden="true">
                    <div class="skeleton-block skeleton-cover"></div>
                    <div class="skeleton-lines">
                        <div class="skeleton-block"></div>
                        <div class="skeleton-block"></div>
                        <div class="skeleton-block"></div>
                    </div>
                </div>
            `;
        }
        grid.innerHTML = html;
        const pageInfo = document.getElementById('store-page-info');
        if (pageInfo) pageInfo.textContent = '';
    },

    back() {
        if (this._tocOpen) {
            this.closeToc();
            return;
        }
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
            // Already in library; let native/OS handle hardware back.
        }
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
                this._renderStore(document.getElementById('store-search-input')?.value || '');
            }
        } catch (e) {
            console.error('Failed to load full store catalog:', e);
        } finally {
            this._storeCatalogLoading = false;
        }
    },

    nextStorePage() {
        const query = document.getElementById('store-search-input').value.toLowerCase();
        const filtered = this._getFilteredStoreBooks(query);

        if ((this._storePage + 1) * this._storePageCount < filtered.length) {
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

    _fetchLocalJson(path) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            // No cache-busting query string: Android WebView XHR against
            // file:///android_asset fails when a "?" is appended.
            xhr.open('GET', path, true);
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

    /** リスト/グリッド表示切替 */
    setStoreViewMode(mode) {
        const m = mode === 'grid' ? 'grid' : 'list';
        YomuStorage.saveSetting('storeViewMode', m);
        const grid = document.getElementById('store-grid');
        if (grid) grid.className = `store-listing ${m}-mode`;
        const listBtn = document.getElementById('store-view-list');
        const gridBtn = document.getElementById('store-view-grid');
        if (listBtn) listBtn.classList.toggle('active', m === 'list');
        if (gridBtn) gridBtn.classList.toggle('active', m === 'grid');
    },

    clearStoreFilters() {
        this._storeFilters = { author: '', category: '', orthography: '' };
        this._storePage = 0;
        const input = document.getElementById('store-search-input');
        if (input) input.value = '';
        this._renderStore('');
    },

    _renderStore(filter = '') {
        const grid = document.getElementById('store-grid');
        const downloaded = YomuStorage.getDownloadedBooks();
        const query = filter.trim().toLowerCase();

        const filtered = this._getFilteredStoreBooks(filter);
        this._renderStoreFilters(filtered.length);

        // View mode (persisted)
        const mode = (YomuStorage.getSettings().storeViewMode === 'grid') ? 'grid' : 'list';
        grid.className = `store-listing ${mode}-mode`;
        const listBtn = document.getElementById('store-view-list');
        const gridBtn = document.getElementById('store-view-grid');
        if (listBtn) listBtn.classList.toggle('active', mode === 'list');
        if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');

        // Slice for pagination
        const start = this._storePage * this._storePageCount;
        const paged = filtered.slice(start, start + this._storePageCount);
        const totalPages = Math.ceil(filtered.length / this._storePageCount) || 1;


        const rowHtml = [];
        const cellHtml = [];
        for (const entry of paged) {
            const book = entry.book;
            const id = book.fileId || book.workId;
            const isDownloaded = downloaded.some(d => d.id === id || (d.aliases && d.aliases.includes(id)));
            const available = book.available !== false || isDownloaded;
            const authorText = book.author || `(著者ID: ${book.authorId})`;
            const action = isDownloaded
                ? `Yomu.openBook('${id}')`
                : (available ? `Yomu.downloadBook('${id}')` : '');
            const btnClass = isDownloaded ? 'downloaded' : (available ? '' : 'unavailable');
            const btnLabel = isDownloaded ? '読む' : (available ? '保存' : '未収録');
            const cat = this._bookCategory(book);
            const metaBits = [
                query && entry.label ? `<span class="match-tag">${this._escapeHtml(entry.label)}</span>` : '',
                this._categoryLabel(cat)
            ].filter(Boolean).join(' · ');

            rowHtml.push(`
                <div class="store-row ${available ? '' : 'unavailable'}" id="store-book-${id}" data-book-id="${this._escapeAttr(id)}" data-book-source="store" ${isDownloaded ? `onclick="Yomu.openBook('${id}')"` : ''}>
                    <div class="store-row-main">
                        <div class="store-row-title">
                            <span>${this._escapeHtml(book.title)}</span>
                            ${isDownloaded ? '<span class="dl-dot" title="ダウンロード済み"></span>' : ''}
                            ${book.hasTrans ? '<span class="dot-e" title="翻訳あり">訳</span>' : ''}
                        </div>
                        <div class="store-row-author">${this._escapeHtml(authorText)}</div>
                        ${metaBits ? `<div class="store-row-meta">${metaBits}</div>` : ''}
                    </div>
                    <div class="book-meta">
                        <button class="download-btn ${btnClass}"
                                id="btn-dl-${id}"
                                ${action ? `onclick="${action}"` : 'disabled'}>
                            ${btnLabel}
                        </button>
                    </div>
                </div>
            `);

            cellHtml.push(`
                <div class="store-cell ${available ? '' : 'unavailable'}" ${isDownloaded ? `onclick="Yomu.openBook('${id}')"` : ''}>
                    <div class="store-cell-title">${this._escapeHtml(book.title)}</div>
                    <div class="store-cell-author">${this._escapeHtml(authorText)}</div>
                    <div class="store-cell-action">
                        <button class="download-btn ${btnClass}" ${action ? `onclick="${action}"` : 'disabled'}>${btnLabel}</button>
                    </div>
                </div>
            `);
        }

        if (paged.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <p>没有找到匹配作品</p>
                    <button class="text-action-btn" onclick="Yomu.clearStoreFilters()">絞り込みをクリア</button>
                </div>
            `;
        } else {
            grid.innerHTML = rowHtml.join('') + cellHtml.join('');
        }

        // Pagination state
        const prevBtn = document.getElementById('btn-prev-page');
        const nextBtn = document.getElementById('btn-next-page');
        if (prevBtn) prevBtn.disabled = this._storePage === 0;
        if (nextBtn) nextBtn.disabled = (this._storePage + 1) * this._storePageCount >= filtered.length;
        const pageInfo = document.getElementById('store-page-info');
        if (pageInfo) pageInfo.textContent = `${this._storePage + 1} / ${totalPages}`;
    },

    toggleStoreFilters(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this._storeFilterPanelOpen = !this._storeFilterPanelOpen;
        const panel = document.getElementById('store-filter-panel');
        const toggle = document.getElementById('store-filter-toggle');
        if (panel) panel.classList.toggle('collapsed', !this._storeFilterPanelOpen);
        if (toggle) {
            toggle.classList.toggle('active', this._storeFilterPanelOpen);
            toggle.setAttribute('aria-expanded', String(this._storeFilterPanelOpen));
        }
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

        const accepts = (book) => {
            const key = `${book.workId}|${book.title}|${book.author}|${book.authorId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            if (this._storeFilters.author && book.author !== this._storeFilters.author) return false;
            if (this._storeFilters.category && this._bookCategory(book) !== this._storeFilters.category) return false;
            if (this._storeFilters.orthography && book.orthography !== this._storeFilters.orthography) return false;
            return true;
        };

        if (!q) {
            return this._storeBooks.filter(book => accepts(book)).map(book => ({ book }));
        }

        // Relevance search (A2): score every catalog entry, then sort by
        // tier (exact title > title prefix > exact author > substrings)
        // keeping catalog order within the same tier.
        const records = this._getStoreSearchRecords();
        const scored = [];
        for (const rec of records) {
            const book = this._storeBooks[rec.i];
            if (!accepts(book)) continue;
            const match = this._matchBook(rec, q);
            if (!match) continue;
            scored.push({ book, tier: match.tier, label: match.label, i: rec.i });
        }
        scored.sort((a, b) => a.tier - b.tier || a.i - b.i);
        return scored;
    },

    /**
     * Lazily built lowercase search records for the store catalog.
     * Cached against the _storeBooks array identity, so swapping the
     * preview catalog for the full one invalidates it automatically.
     */
    _getStoreSearchRecords() {
        if (this._storeSearchRecords && this._storeSearchRecords.src === this._storeBooks) {
            return this._storeSearchRecords.list;
        }
        const list = this._storeBooks.map((book, i) => ({
            i,
            title: (book.title || '').toLowerCase(),
            titleKana: (book.titleKana || '').toLowerCase(),
            author: (book.author || '').toLowerCase(),
            authorKana: (book.authorKana || '').toLowerCase(),
            authorRoman: (book.authorRoman || '').toLowerCase(),
            other: [
                book.authorId, book.workId, book.fileId, book.ndc,
                book.orthography, book.baseBook, book.baseBookTitle, book.desc
            ].filter(Boolean).join(' ').toLowerCase()
        }));
        this._storeSearchRecords = { src: this._storeBooks, list };
        return list;
    },

    /**
     * Relevance tiers (A2): 精确タイトル > 読み一致 > タイトル前方 > 読み前方 >
     * 精確著者 > 著者読み > 著者前方 > 部分一致（タイトル/読み/著者）> その他.
     * Returns null when the record does not match the query at all.
     */
    _matchBook(rec, q) {
        if (rec.title === q) return { tier: 0, label: 'タイトル一致' };
        if (rec.titleKana === q) return { tier: 1, label: '読み一致' };
        if (rec.title.startsWith(q)) return { tier: 2, label: 'タイトル前方' };
        if (rec.titleKana.startsWith(q)) return { tier: 3, label: '読み前方' };
        if (rec.author === q) return { tier: 4, label: '著者一致' };
        if (rec.authorKana === q || rec.authorRoman === q) return { tier: 5, label: '著者読み一致' };
        if (rec.author.startsWith(q)) return { tier: 6, label: '著者前方' };
        if (rec.title.includes(q)) return { tier: 7, label: 'タイトル部分' };
        if (rec.titleKana.includes(q)) return { tier: 8, label: '読み部分' };
        if (rec.author.includes(q) || rec.authorKana.includes(q) || rec.authorRoman.includes(q)) {
            return { tier: 9, label: '著者部分' };
        }
        if (rec.other.includes(q)) return { tier: 10, label: 'その他' };
        return null;
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

        document.querySelectorAll('#store-view .filter-chip[data-filter-type]').forEach(btn => {
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
            summary.textContent = `${resultCount.toLocaleString()} 件${active.length ? ' · ' + active.join(' / ') : ''}${loading}`;
        }

        // Hero subtitle: 収録数と現在の絞り込み
        const sub = document.getElementById('store-sub');
        if (sub) {
            const active = [
                this._storeFilters.author,
                this._categoryLabel(this._storeFilters.category),
                this._storeFilters.orthography
            ].filter(Boolean);
            const total = this._storeCatalogLoaded ? this._storeBooks.length.toLocaleString() : '…';
            sub.textContent = `青空文庫 ${total} 点${active.length ? ' · ' + active.join(' / ') : ''}`;
        }

        const activeCount = ['author', 'category', 'orthography']
            .filter(k => this._storeFilters[k]).length;
        const badge = document.getElementById('store-active-filter-count');
        if (badge) badge.textContent = activeCount > 0 ? String(activeCount) : '';
        const toggleBtn = document.getElementById('store-filter-toggle');
        if (toggleBtn) toggleBtn.classList.toggle('has-active', activeCount > 0);
    },

    _filterButton(type, value, label, count = null) {
        const active = this._storeFilters[type] === value ? ' active' : '';
        const action = `Yomu.setStoreFilter(${JSON.stringify(type)}, ${JSON.stringify(value)})`;
        const countHtml = count !== null ? `<span class="chip-count">${count}</span>` : '';
        return `<button class="filter-chip${active}" data-filter-type="${this._escapeAttr(type)}" data-filter-value="${this._escapeAttr(value)}" onclick="${this._escapeAttr(action)}"><span class="chip-label">${this._escapeHtml(label)}</span>${countHtml}</button>`;
    },

    _bookCategory(book) {
        const id = book.id || book.fileId || '';
        const title = book.title || '';

        // Curated children's classics: keep them in 児童文学 even when the
        // Aozora record's NDC comes from a general-fiction edition.
        if (['gingatetsudo', 'kumo_no_ito', 'yodaka_no_hoshi', 'chumon_ryori', 'yuki_onna'].includes(id)) {
            return 'children';
        }
        if (id === 'gakumon_no_susume') return 'essay';

        // NDC: the main class (913 etc.) defines the genre. The juvenile
        // sub-table marker K only marks a children's edition of that class —
        // e.g. 羅生門 tagged `NDC K913` by its 底本 stays 小説 (B2), while a
        // K-only code with no numeric class falls back to 児童文学.
        const codes = (book.ndc || '').split(/[\s/、]+/).filter(Boolean).map(c => c.replace(/^NDC\s*/, ''));
        const numeric = codes.map(c => c.replace(/^K/, ''));
        const match = (re) => numeric.some(c => re.test(c));
        const hasNumeric = numeric.some(c => /^\d/.test(c));

        if (match(/^913/)) return 'fiction';
        if (match(/^911/)) return 'poetry';
        if (match(/^912/)) return 'drama';
        if (match(/^91[456]/)) return 'essay';
        if (match(/^9[2-9]/)) return 'foreign';
        if (!hasNumeric && codes.some(c => /^K/.test(c))) return 'children';

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

    async downloadBook(bookId) {
        const book = this._storeBooks.find(b => (b.fileId || b.workId) === bookId);
        if (!book) return;

        // Check if already downloaded
        if (YomuStorage.getDownloadedBooks().some(d => d.id === bookId)) {
            this.openBook(bookId);
            return;
        }

        // Honest availability guard: the catalog may list works whose text
        // data is not in this build. Fail with a clear message up front
        // instead of a fake network error after a 404.
        if (book.available === false) {
            this.alert('この作品の本文データはこのビルドに収録されていません。', '本文データ未収録');
            return;
        }

        // One download per book at a time. Nothing is persisted until the
        // whole book is fetched and saved, so retrying after an interrupted
        // download starts from a clean state.
        if (!this._downloadsInFlight) this._downloadsInFlight = new Set();
        if (this._downloadsInFlight.has(bookId)) return;
        this._downloadsInFlight.add(bookId);

        // Mobile UX: non-blocking toast + shelf card badge (replaces modal dialog)
        this._setStoreCardDownloading(bookId, true);

        // C2: 可中止下载 — toast 内「中止」按钮触发 AbortController
        const controller = new AbortController();
        if (!this._downloadControllers) this._downloadControllers = new Map();
        this._downloadControllers.set(bookId, controller);
        const dlToast = this._toastDownloadStart(book.title, () => controller.abort());

        const updateStatus = (text, progress) => {
            dlToast.update(text, progress);
        };

        try {
            updateStatus(window.YomuNative ? '作品データをダウンロード中...' : '作品データを読み込み中...', 30);
            const processed = await YomuAozora.downloadBook(book, {
                signal: controller.signal,
                onProgress: (frac) => {
                    if (frac == null) {
                        updateStatus('作品データをダウンロード中...', 45); // 不定进度
                    } else {
                        // 10%(開始)〜65%(受信完了) の帯域に写像
                        updateStatus(`ダウンロード中... ${Math.round(frac * 100)}%`, 10 + Math.round(frac * 55));
                    }
                }
            });
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
            this._setStoreCardDownloading(bookId, false);
            this._markNewBook(bookId);
            dlToast.finish('本棚に追加しました');

            // Refresh store in background
            setTimeout(() => this._renderStore(document.getElementById('store-search-input')?.value || ''), 100);

            // A1 下载→阅读状态机: explicitly open the downloaded book so that
            // reader-view.active, hash, app state and rendered content all
            // land on the same book. No leftover store modal/state.
            await this.openBook(bookId);
        } catch (e) {
            const aborted = e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));
            if (aborted) {
                console.log('Download aborted by user:', bookId);
                dlToast.fail('ダウンロードを中断しました');
            } else {
                console.error('Download failed:', e);
                const notFound = typeof e === 'object' && e !== null && /HTTP 40[04]/.test(e.message || '');
                dlToast.fail(notFound
                    ? 'この作品の本文データはこのビルドに収録されていません。'
                    : '本棚への追加に失敗しました。接続を確認してください。');
            }
            this._setStoreCardDownloading(bookId, false);
        } finally {
            this._downloadsInFlight.delete(bookId);
            if (this._downloadControllers) this._downloadControllers.delete(bookId);
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

    // ===== Table of Contents =====
    toggleToc(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (this._tocOpen) {
            this.closeToc();
        } else {
            this.openToc();
        }
    },

    openToc() {
        const overlay = document.getElementById('toc-overlay');
        const panel = document.getElementById('toc-panel');
        const list = document.getElementById('toc-list');
        if (!overlay || !panel || !list) return;

        const chapters = this.reader.getChapters();
        if (chapters.length === 0) {
            list.innerHTML = '<div class="toc-empty">この作品には目次情報がありません。</div>';
        } else {
            const current = this.reader.getCurrentChapterIndex();
            list.innerHTML = chapters.map((ch, i) => `
                <button class="toc-item ${i === current ? 'current' : ''}" onclick="Yomu.jumpToToc(${i})">
                    ${ch.level > 0 ? `<span class="toc-level-sub">${this._escapeHtml(ch.title)}</span>` : this._escapeHtml(ch.title)}
                </button>
            `).join('');
        }

        overlay.classList.add('active');
        panel.classList.add('open');
        this._tocOpen = true;

        if (window.YomuBookmarks) {
            YomuBookmarks.renderTocSection(document.getElementById('toc-bookmarks'));
        }

        const currentItem = list.querySelector('.toc-item.current');
        if (currentItem) currentItem.scrollIntoView({ block: 'center' });
    },

    closeToc() {
        const overlay = document.getElementById('toc-overlay');
        const panel = document.getElementById('toc-panel');
        if (overlay) overlay.classList.remove('active');
        if (panel) panel.classList.remove('open');
        this._tocOpen = false;
    },

    jumpToToc(index) {
        this.closeToc();
        this.reader.jumpToChapter(index);
        this.setReaderControlsVisible(true);
    },

    // Furigana toggle
    toggleFurigana() {
        const settings = YomuStorage.getSettings();
        const currentMode = settings.furiganaMode || 'none';
        const nextMode = currentMode === 'none' ? 'internal' : 'none';
        this.setFuriganaMode(nextMode);
    },

    // ===== B4: 段落しおり/ハイライト/ノート =====
    openParagraphMenu(bookId, paraIndex) {
        const overlay = document.getElementById('action-sheet-overlay');
        const sheet = document.getElementById('action-sheet');
        if (!overlay || !sheet) return;

        const entry = window.YomuBookmarks ? YomuBookmarks.get(bookId, paraIndex) : null;
        const para = (typeof YomuReader !== 'undefined' && YomuReader._paragraphs) ? YomuReader._paragraphs[paraIndex] : null;

        const ICON_STAR = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l2.4 6.3 6.6.4-5.1 4.3 1.7 6.4L12 15.9l-5.6 3.5 1.7-6.4L3 8.7l6.6-.4z"></path></svg>';
        const ICON_HL = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path></svg>';
        const ICON_NOTE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
        const ICON_TRANS = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><line x1="14" y1="18" x2="20" y2="18"></line></svg>';
        const ICON_GRAM = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>';

        const actions = [
            { icon: ICON_STAR, label: (entry && entry.b) ? 'しおり解除' : 'しおり', fn: () => { YomuBookmarks.toggleBookmark(bookId, paraIndex, para); } },
            { icon: ICON_HL, label: (entry && entry.hl) ? 'ハイライト解除' : 'ハイライト', fn: () => { YomuBookmarks.toggleHighlight(bookId, paraIndex, para); } },
            { icon: ICON_NOTE, label: (entry && entry.n) ? 'ノート編集' : 'ノート追加', fn: () => {
                const cur = (YomuBookmarks.get(bookId, paraIndex) || {}).n || '';
                YomuPop.prompt({
                    title: 'ノート',
                    label: 'この段落へのメモ（最大2000字）',
                    value: cur,
                    maxlength: 2000,
                    placeholder: '感想・文法メモなど…'
                }).then(note => {
                    if (note !== null) YomuBookmarks.setNote(bookId, paraIndex, note, para);
                });
            } }
        ];
        // C6: AI 段落翻訳/文法解説（用户自带 key，未配置时也显示并引导设置）
        if (window.YomuAI) {
            actions.push({ icon: ICON_TRANS, label: 'AI 翻訳', fn: () => this.runAiOnParagraph(bookId, paraIndex, 'translate') });
            actions.push({ icon: ICON_GRAM, label: 'AI 文法解説', fn: () => this.runAiOnParagraph(bookId, paraIndex, 'grammar') });
        }

        sheet.innerHTML = `
            <div class="action-sheet-title">${this._escapeHtml((para && para.content || '').slice(0, 60))}</div>
            ${actions.map((a, i) => `<button class="action-sheet-btn" data-action="${i}">${a.icon}<span>${this._escapeHtml(a.label)}</span></button>`).join('')}
            <button class="action-sheet-btn cancel">キャンセル</button>
        `;
        sheet.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeActionSheet();
                actions[parseInt(btn.dataset.action, 10)].fn();
                if (window.YomuBookmarks) YomuBookmarks.apply(bookId, paraIndex, paraIndex + 1);
            });
        });
        const cancelBtn = sheet.querySelector('.cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeActionSheet());

        overlay.classList.add('active');
        sheet.classList.add('active');
    },

    _paragraphFromEvent(e) {
        if (!this._isReaderOpen) return null;
        const el = e.target.closest && e.target.closest('#novel-content [id^="p-"]');
        if (!el) return null;
        const m = el.id.match(/^p-(\d+)$/);
        if (!m) return null;
        const book = (typeof YomuReader !== 'undefined') ? YomuReader.getCurrentBook() : null;
        if (!book) return null;
        return { bookId: book.id, paraIndex: parseInt(m[1], 10) };
    },

    // ===== Font pair (漢字/かな 別指定) =====
    async setFontPair(kanji, kana, opts = {}) {
        YomuStorage.saveSetting('fontKanji', kanji);
        YomuStorage.saveSetting('fontKana', kana);

        // 即時反映（未ダウンロードなら font-display:swap で後から差し替え）
        YomuFonts.apply(kanji, kana);
        this._updateFontUI();

        const token = this._fontLoadToken = (this._fontLoadToken || 0) + 1;
        const ids = [...new Set([kanji, kana])].filter(id => YomuFonts.FONTS[id]);
        for (const id of ids) {
            const toast = opts.silent ? null
                : this.showToast(`「${YomuFonts.FONTS[id].label}」を準備中...`, { id: 'font-dl', duration: 0 });
            const ok = await YomuFonts.load(id, p => toast && toast.update(null, p));
            if (token !== this._fontLoadToken) {
                if (toast) toast.hide();
                return;
            }
            if (toast) {
                if (ok) toast.finish('フォント準備完了');
                else toast.fail('フォント取得に失敗しました（通信環境を確認してください）');
            }
        }
    },

    onFontSelect(slot, value) {
        const cur = YomuFonts.current;
        this.setFontPair(slot === 'kanji' ? value : cur.kanji,
                         slot === 'kana' ? value : cur.kana);
    },

    applyFontPreset(presetId) {
        const p = YomuFonts.PRESETS[presetId];
        if (p) this.setFontPair(p.kanji, p.kana);
    },

    _initFontUI() {
        if (!window.YomuPop) return;
        const options = [
            { id: 'mincho', label: 'システム（明朝）' },
            { id: 'gothic', label: 'システム（ゴシック）' },
            ...Object.entries(YomuFonts.FONTS).map(([id, f]) => ({ id, label: f.label }))
        ];
        for (const slot of ['kanji', 'kana']) {
            const host = document.getElementById(`font-${slot}-select`);
            if (!host || host._ypInit) continue;
            host._ypInit = true;
            YomuPop.select({
                trigger: host,
                options: options.map(o => ({ value: o.id, label: o.label })),
                value: 'mincho',
                onChange: (v) => this.onFontSelect(slot, v)
            });
        }
    },

    _updateFontUI() {
        const cur = YomuFonts.current;
        for (const slot of ['kanji', 'kana']) {
            const host = document.getElementById(`font-${slot}-select`);
            if (host && host.setValue) host.setValue(cur[slot] || 'mincho');
        }
        document.querySelectorAll('.font-preset-btn').forEach(btn => {
            btn.classList.toggle('active', YomuFonts.isPresetActive(btn.dataset.preset));
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
            if (window.YomuStats) YomuStats._renderUI();
            if (window.YomuAI) this.restoreAiConfigUI();
        }
    },

    // ===== C4: 自動スクロール =====
    toggleAutoScroll() {
        if (this._autoScrollActive) {
            this.stopAutoScroll();
        } else {
            this.startAutoScroll();
        }
    },

    startAutoScroll() {
        if (this._autoScrollActive || !this._isReaderOpen) return;
        const speeds = { slow: 24, normal: 48, fast: 90 };
        const pxPerSec = speeds[(YomuStorage.getSettings().autoScrollSpeed)] || speeds.normal;
        this._autoScrollActive = true;
        const btn = document.getElementById('autoscroll-btn');
        if (btn) btn.classList.add('active');
        let last = performance.now();
        let acc = 0;
        const step = (now) => {
            if (!this._autoScrollActive) return;
            acc += (now - last) / 1000 * pxPerSec;
            last = now;
            if (acc >= 1) {
                const d = Math.floor(acc);
                acc -= d;
                window.scrollBy(0, d);
            }
            this._autoScrollRaf = requestAnimationFrame(step);
        };
        this._autoScrollRaf = requestAnimationFrame(step);
        this.showToast('自動スクロール開始（タップで停止）');
        // 用户任何交互即停止（墨水屏设备友好）
        const stop = () => this.stopAutoScroll();
        this._autoScrollStop = stop;
        window.addEventListener('pointerdown', stop, { once: true, capture: true });
        window.addEventListener('keydown', stop, { once: true, capture: true });
        window.addEventListener('wheel', stop, { once: true, capture: true });
    },

    stopAutoScroll() {
        if (!this._autoScrollActive) return;
        this._autoScrollActive = false;
        if (this._autoScrollRaf) cancelAnimationFrame(this._autoScrollRaf);
        const btn = document.getElementById('autoscroll-btn');
        if (btn) btn.classList.remove('active');
        window.removeEventListener('pointerdown', this._autoScrollStop, { capture: true });
        window.removeEventListener('keydown', this._autoScrollStop, { capture: true });
        window.removeEventListener('wheel', this._autoScrollStop, { capture: true });
        if (this._autoScrollStop) this.showToast('自動スクロール停止');
        this._autoScrollStop = null;
    },

    setAutoScrollSpeed(v) {
        const allowed = ['slow', 'normal', 'fast'];
        const speed = allowed.includes(v) ? v : 'normal';
        YomuStorage.saveSetting('autoScrollSpeed', speed);
        if (this._autoScrollActive) {
            this.stopAutoScroll();
            this.startAutoScroll();
        }
    },

    // ===== C6: AI 翻訳/文法解説 =====
    onAiProviderChange(providerId) {
        const preset = (window.YomuAI && YomuAI.PRESETS[providerId]) || { baseUrl: '', model: '' };
        const baseInput = document.getElementById('ai-baseurl-input');
        const modelInput = document.getElementById('ai-model-input');
        if (baseInput) baseInput.value = preset.baseUrl || '';
        if (modelInput) modelInput.value = preset.model || '';
        this.saveAiConfig(providerId);
    },

    saveAiConfig(providerId) {
        if (!window.YomuAI) return;
        const provider = providerId ||
            ((document.getElementById('ai-provider-select') || {})._ypValue) || 'custom';
        const cfg = {
            provider,
            baseUrl: ((document.getElementById('ai-baseurl-input') || {}).value || '').trim(),
            model: ((document.getElementById('ai-model-input') || {}).value || '').trim(),
            apiKey: ((document.getElementById('ai-key-input') || {}).value || '').trim(),
            format: (YomuAI.PRESETS[provider] || {}).format === 'gemini' ? 'gemini' : 'openai'
        };
        if (cfg.baseUrl) {
            YomuAI.saveConfig(cfg);
            this.showToast('AI 設定を保存しました（キーは本端末のみ）');
        } else {
            YomuAI.clearConfig();
        }
    },

    restoreAiConfigUI() {
        const cfg = window.YomuAI ? YomuAI.getConfig() : null;
        const providerSel = document.getElementById('ai-provider-select');
        const baseInput = document.getElementById('ai-baseurl-input');
        const modelInput = document.getElementById('ai-model-input');
        const keyInput = document.getElementById('ai-key-input');
        if (providerSel && providerSel.setValue) providerSel.setValue((cfg && cfg.provider) || 'zhipu');
        if (baseInput) baseInput.value = (cfg && cfg.baseUrl) || ((YomuAI.PRESETS.zhipu || {}).baseUrl || '');
        if (modelInput) modelInput.value = (cfg && cfg.model) || 'glm-4-flash';
        if (keyInput) keyInput.value = (cfg && cfg.apiKey) || '';
    },

    async runAiOnParagraph(bookId, paraIndex, kind) {
        const para = document.getElementById(`p-${paraIndex}`);
        const text = para ? para.textContent.trim() : '';
        if (!text) return;

        const overlay = document.getElementById('ai-panel-overlay');
        const titleEl = document.getElementById('ai-panel-title');
        const sourceEl = document.getElementById('ai-panel-source');
        const bodyEl = document.getElementById('ai-panel-body');
        if (!overlay) return;
        titleEl.textContent = kind === 'grammar' ? 'AI 文法解説' : 'AI 翻訳';
        sourceEl.textContent = text.length > 160 ? text.slice(0, 160) + '…' : text;
        bodyEl.innerHTML = '<div class="ai-status">リクエスト中...</div>';
        overlay.classList.add('active');

        const run = async () => {
            bodyEl.innerHTML = '<div class="ai-status">リクエスト中...</div>';
            try {
                const out = await YomuAI.explain(text, kind);
                bodyEl.innerHTML = '';
                const pre = document.createElement('div');
                pre.className = 'ai-result';
                pre.textContent = out;
                bodyEl.appendChild(pre);
            } catch (e) {
                console.warn('[AI] request failed:', e);
                bodyEl.innerHTML = `
                    <div class="ai-status ai-status-error">${this._escapeHtml(e.message || 'リクエスト失敗')}</div>
                    <button class="settings-btn" type="button" id="ai-retry-btn">再試行</button>
                `;
                const btn = document.getElementById('ai-retry-btn');
                if (btn) btn.addEventListener('click', run);
            }
        };
        await run();
    },

    closeAiPanel() {
        const overlay = document.getElementById('ai-panel-overlay');
        if (overlay) overlay.classList.remove('active');
    },

    // ===== Mobile UX: toasts =====
    showToast(message, opts = {}) {
        const container = document.getElementById('toast-container');
        const noop = { update() {}, finish() {}, fail() {}, hide() {} };
        if (!container) return noop;

        const { type = '', duration = 2400, id = null } = opts;
        let el = id ? container.querySelector(`.toast[data-id="${id}"]`) : null;
        if (!el) {
            el = document.createElement('div');
            el.className = `toast ${type}`;

            if (id) el.dataset.id = id;
            el.innerHTML = '<span class="toast-text"></span>';
            container.appendChild(el);
        }

        const textEl = el.querySelector('.toast-text');
        if (textEl && message) textEl.textContent = message;
        requestAnimationFrame(() => el.classList.add('show'));

        let timer = null;
        const hide = () => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        };
        if (duration > 0) timer = setTimeout(hide, duration);

        const setBar = (progress) => {
            let bar = el.querySelector('.toast-progress>span');
            if (!bar) {
                const wrap = document.createElement('div');
                wrap.className = 'toast-progress';
                wrap.appendChild(document.createElement('span'));
                el.appendChild(wrap);
                bar = wrap.firstChild;
            }
            bar.style.width = progress + '%';
        };

        return {
            update(text, progress) {
                if (textEl && text != null) textEl.textContent = text;
                if (progress != null) setBar(progress);
                if (timer) { clearTimeout(timer); timer = null; }
            },
            finish(text) {
                if (textEl && text) textEl.textContent = text;
                setBar(100);
                if (timer) clearTimeout(timer);
                timer = setTimeout(hide, 1800);
            },
            fail(text) {
                el.classList.add('toast-error');
                if (textEl && text) textEl.textContent = text;
                if (timer) clearTimeout(timer);
                timer = setTimeout(hide, 3500);
            },
            hide
        };
    },

    _toastDownloadStart(title, onCancel) {
        const t = this.showToast(`「${title}」を取得中...`, { id: 'download', duration: 0 });
        t.update(null, 10);
        // C2: 中止按钮（可选）
        if (typeof onCancel === 'function') {
            const container = document.getElementById('toast-container');
            const el = container ? container.querySelector('.toast[data-id="download"]') : null;
            if (el && !el.querySelector('.toast-cancel')) {
                const btn = document.createElement('button');
                btn.className = 'toast-cancel';
                btn.type = 'button';
                btn.textContent = '中止';
                btn.addEventListener('click', () => {
                    btn.disabled = true;
                    onCancel();
                });
                el.appendChild(btn);
            }
        }
        return t;
    },

    _setStoreCardDownloading(bookId, on) {
        const card = document.getElementById(`store-book-${bookId}`);
        if (card) card.classList.toggle('downloading', Boolean(on));
    },

    // ===== B5: JLPT 難度表示切替 =====
    setJlptShow(enabled) {
        const on = Boolean(enabled);
        YomuStorage.saveSetting('jlptShow', on);
        const toggle = document.getElementById('jlpt-show-toggle');
        if (toggle) toggle.checked = on;
    },

    // ===== C1: ローカル .txt / .epub インポート =====
    pickLocalFile() {
        const input = document.getElementById('local-file-input');
        if (!input) return;
        input.value = '';
        input.click();
    },

    async onLocalFilePicked(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        this.showToast?.('読み込み中: ' + file.name);
        try {
            const meta = await YomuImporter.importFile(file);
            this._renderBookList();
            if (this.showToast) this.showToast(`「${meta.title}」を書架に追加しました`);
        } catch (e) {
            console.error('[Import] failed:', e);
            if (this.showToast) this.showToast('インポート失敗: ' + e.message);
        }
    },

    _getNewBookIds() {
        if (!this._newBookIds) {
            this._newBookIds = new Set(YomuStorage.get('new_books', []));
        }
        return this._newBookIds;
    },

    _isNewBook(id) {
        return this._getNewBookIds().has(id);
    },

    scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    _markNewBook(id) {
        const set = this._getNewBookIds();
        set.add(id);
        YomuStorage.set('new_books', Array.from(set).slice(-50));
    },

    _consumeNewBadge(id) {
        const set = this._getNewBookIds();
        if (set.delete(id)) {
            YomuStorage.set('new_books', Array.from(set));
        }
    },

    // ===== Mobile UX: reader settings (margin / theme / brightness) =====
    setMargin(px) {
        const val = Math.max(12, Math.min(48, parseInt(px) || 24));
        document.documentElement.style.setProperty('--reader-margin', val + 'px');
        YomuStorage.saveSetting('readerMargin', val);
        const display = document.getElementById('margin-value');
        if (display) display.textContent = val + 'px';
        const slider = document.getElementById('margin-slider');
        if (slider && parseInt(slider.value) !== val) slider.value = val;
    },

    adjustMargin(delta) {
        const slider = document.getElementById('margin-slider');
        if (!slider) return;
        const newVal = parseInt(slider.value) + delta;
        if (newVal >= parseInt(slider.min) && newVal <= parseInt(slider.max)) {
            slider.value = newVal;
            this.setMargin(newVal);
        }
    },

    setTheme(theme) {
        const valid = ['light', 'sepia', 'green', 'dark'];
        if (!valid.includes(theme)) theme = 'light';
        document.body.classList.remove('theme-sepia', 'theme-green', 'theme-dark');
        if (theme !== 'light') document.body.classList.add(`theme-${theme}`);
        YomuStorage.saveSetting('theme', theme);
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
        // Keep the PWA chrome color in sync with the reading theme
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', getComputedStyle(document.body).backgroundColor);
    },

    setBrightness(val) {
        const v = Math.max(50, Math.min(100, parseInt(val) || 100));
        const overlay = document.getElementById('brightness-overlay');
        if (overlay) overlay.style.opacity = String(((100 - v) / 100) * 0.55);
        YomuStorage.saveSetting('brightness', v);
        const slider = document.getElementById('brightness-slider');
        if (slider && parseInt(slider.value) !== v) slider.value = v;
    },

    adjustBrightness(delta) {
        const slider = document.getElementById('brightness-slider');
        if (!slider) return;
        const newVal = parseInt(slider.value) + delta;
        if (newVal >= parseInt(slider.min) && newVal <= parseInt(slider.max)) {
            slider.value = newVal;
            this.setBrightness(newVal);
        }
    },

    toggleImmersive(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        const on = !document.body.classList.contains('reader-immersive');
        document.body.classList.toggle('reader-immersive', on);
        const btn = document.getElementById('immersive-toggle-btn');
        if (btn) btn.classList.toggle('active', on);
        this.setReaderControlsVisible(true);
    },

    // ===== Mobile UX: long-press action sheet =====
    openBookMenu(bookId, source, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!bookId) return;
        const ICONS = {
            book: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
            dl: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
            trash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
            info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
        };

        let book = null;
        let isDownloaded = false;
        if (source === 'store') {
            book = this._storeBooks.find(b => (b.fileId || b.workId) === bookId);
            isDownloaded = YomuStorage.getDownloadedBooks().some(d => d.id === bookId);
        } else {
            book = this._getLibraryBooks().find(b => b.id === bookId);
            isDownloaded = Boolean(book && book.isDownloaded);
        }
        if (!book) return;

        const overlay = document.getElementById('action-sheet-overlay');
        const sheet = document.getElementById('action-sheet');
        if (!overlay || !sheet) return;

        const title = book.title || '';
        const actions = [];
        if (source === 'store') {
            if (isDownloaded) {
                actions.push({ icon: ICONS.book, label: '読む', fn: () => this.openBook(bookId) });
                actions.push({ icon: ICONS.trash, label: 'ダウンロードを削除', danger: true, fn: () => this.deleteBook({ stopPropagation() {} }, bookId, title) });
            } else if (book.available !== false) {
                actions.push({ icon: ICONS.dl, label: 'オフライン保存', fn: () => this.downloadBook(bookId) });
            }
        } else {
            actions.push({ icon: ICONS.book, label: '読む', fn: () => this.openBook(bookId) });
            actions.push({ icon: ICONS.info, label: '詳細', fn: () => this._showBookDetails(book) });
            if (isDownloaded) {
                actions.push({ icon: ICONS.trash, label: 'この本を削除', danger: true, fn: () => this.deleteBook({ stopPropagation() {} }, bookId, title) });
            }
        }
        if (actions.length === 0) return;

        sheet.innerHTML = `
            <div class="action-sheet-title">${this._escapeHtml(title)}</div>
            ${actions.map((a, i) => `<button class="action-sheet-btn ${a.danger ? 'danger' : ''}" data-action="${i}">${a.icon}<span>${this._escapeHtml(a.label)}</span></button>`).join('')}
            <button class="action-sheet-btn cancel">キャンセル</button>
        `;
        sheet.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeActionSheet();
                actions[parseInt(btn.dataset.action, 10)].fn();
            });
        });
        const cancelBtn = sheet.querySelector('.cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeActionSheet());

        overlay.classList.add('active');
        sheet.classList.add('active');
    },

    closeActionSheet() {
        const overlay = document.getElementById('action-sheet-overlay');
        const sheet = document.getElementById('action-sheet');
        if (overlay) overlay.classList.remove('active');
        if (sheet) sheet.classList.remove('active');
    },

    _showBookDetails(book) {
        const lines = [
            book.title || '',
            book.author || '',
            book.desc || '',
            this._categoryLabel(this._bookCategory(book))
        ].filter(Boolean);
        this.alert(lines.join('\n'), '詳細');
    },

    // ===== Mobile UX: gestures wiring =====
    _initMobileUX() {
        // Back-to-top availability follows reading depth
        window.addEventListener('scroll', () => {
            if (this._isReaderOpen) {
                document.body.classList.toggle('past-scroll-depth', window.scrollY > 600);
            }
        }, { passive: true });

        // Row long-press menu (shelf + store); desktop gets right-click
        const rowSelector = '.book-row, .store-row';
        let lpTimer = null;
        let lpFired = false;
        document.addEventListener('touchstart', (e) => {
            const card = e.target.closest && e.target.closest(rowSelector);
            if (!card || this._isReaderOpen) return;
            lpFired = false;
            lpTimer = setTimeout(() => {
                lpFired = true;
                if (navigator.vibrate) navigator.vibrate(12);
                this.openBookMenu(card.dataset.bookId, card.dataset.bookSource);
            }, 500);
        }, { passive: true });
        const cancelLp = () => {
            if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        };
        document.addEventListener('touchmove', cancelLp, { passive: true });
        document.addEventListener('touchend', (e) => {
            cancelLp();
            if (lpFired) {
                lpFired = false;
                e.preventDefault();
                e.stopPropagation();
            }
        }, { passive: false });
        document.addEventListener('contextmenu', (e) => {
            const card = e.target.closest && e.target.closest(rowSelector);
            if (card && !this._isReaderOpen) {
                e.preventDefault();
                this.openBookMenu(card.dataset.bookId, card.dataset.bookSource);
            }
        });

        this._initPullToRefresh();

        // B4: 阅读器段落长按 → しおり/ハイライト/ノート 菜单
        let paraLpTimer = null;
        let paraLpFired = false;
        document.addEventListener('touchstart', (e) => {
            if (!this._isReaderOpen || e.touches.length !== 1) return;
            const target = this._paragraphFromEvent(e);
            if (!target) return;
            paraLpFired = false;
            paraLpTimer = setTimeout(() => {
                paraLpFired = true;
                if (navigator.vibrate) navigator.vibrate(12);
                this.openParagraphMenu(target.bookId, target.paraIndex);
            }, 500);
        }, { passive: true });
        const cancelParaLp = () => {
            if (paraLpTimer) { clearTimeout(paraLpTimer); paraLpTimer = null; }
        };
        document.addEventListener('touchmove', cancelParaLp, { passive: true });
        document.addEventListener('touchend', (e) => {
            cancelParaLp();
            if (paraLpFired) {
                paraLpFired = false;
                e.preventDefault();
                e.stopPropagation();
            }
        }, { passive: false });
        document.addEventListener('contextmenu', (e) => {
            const target = this._paragraphFromEvent(e);
            if (target) {
                e.preventDefault();
                this.openParagraphMenu(target.bookId, target.paraIndex);
            }
        });
    },

    _initPullToRefresh() {
        let startY = 0;
        let pulling = false;
        let armed = false;
        let indicator = null;
        const TRIGGER = 72;

        const getIndicator = () => {
            if (!indicator || !indicator.isConnected) {
                indicator = document.createElement('div');
                indicator.className = 'ptr-indicator';
                indicator.textContent = '↓';
                document.body.appendChild(indicator);
            }
            return indicator;
        };

        document.addEventListener('touchstart', (e) => {
            if (this._isReaderOpen || window.scrollY > 0 || e.touches.length !== 1) return;
            const t = e.touches[0];
            if (t.target.closest && t.target.closest('input, textarea, select, button, .book-row, .store-row, .continue-item')) {
                pulling = false;
                return;
            }
            startY = t.clientY;
            pulling = true;
            armed = false;
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!pulling || this._isReaderOpen) return;
            const dy = e.touches[0].clientY - startY;
            if (dy <= 0) {
                if (indicator) indicator.classList.remove('visible');
                return;
            }
            const ind = getIndicator();
            const drag = Math.min(dy * 0.4, 96);
            ind.classList.add('visible');
            ind.style.transform = `translate(-50%, ${-70 + drag}px)`;
            armed = dy >= TRIGGER;
            ind.classList.toggle('armed', armed);
            ind.textContent = armed ? '↻' : '↓';
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (!pulling) return;
            pulling = false;
            if (indicator) {
                indicator.classList.remove('visible', 'armed');
                indicator.style.transform = '';
                indicator.textContent = '↓';
            }
            if (armed) {
                armed = false;
                this._refreshCurrentList();
            }
        });
    },

    _refreshCurrentList() {
        if (this._storeOpen) {
            this._renderStore(document.getElementById('store-search-input')?.value || '');
            this.showToast('書庫を更新しました');
        } else if (!this._isReaderOpen) {
            this._renderBookList();
            this.showToast('書架を更新しました');
        }
    },

    _fetchVersion() {
        const el = document.getElementById('settings-version');
        if (!el) return;

        const settings = YomuStorage.getSettings();
        const ver = settings.version || this._localVersion;

        if (ver) {
            el.textContent = ver;
        }
    },

    async deleteBook(event, bookId, title) {
        if (event && event.stopPropagation) event.stopPropagation(); // Don't open the book
        const ok = await this.confirm(`「${title}」を削除しますか？`);
        if (ok) {
            // C1: ローカル导入书走 syncedBooks 移除；下载书走原路径
            const settings = YomuStorage.getSettings();
            const isLocal = Array.isArray(settings.syncedBooks) &&
                settings.syncedBooks.some(b => b.id === bookId);
            if (isLocal && window.YomuImporter) {
                YomuImporter.removeLocalBook(bookId);
            } else {
                YomuStorage.removeDownloadedBook(bookId);
                // C2: 释放 SW HTTP 缓存（data/novels/{id}.json 等）
                this._purgeHttpCacheForBook(bookId);
            }
            this._renderBookList();
        }
    },

    /** C2: 删除单本时释放 Service Worker 缓存中的本书数据 */
    async _purgeHttpCacheForBook(bookId) {
        if (!('caches' in window)) return;
        try {
            const names = await caches.keys();
            for (const name of names) {
                const cache = await caches.open(name);
                const keys = await cache.keys();
                for (const req of keys) {
                    const u = new URL(req.url);
                    if (u.pathname === `/data/novels/${bookId}.json` ||
                        u.pathname.endsWith(`/data/novels/${bookId}.json`)) {
                        await cache.delete(req);
                        console.log('[Cache] purged', u.pathname);
                    }
                }
            }
        } catch (e) {
            console.warn('[Cache] purge failed:', e);
        }
    },

    // ===== C5: 学习数据一括書き出し/読み込み =====
    exportBackup() {
        const bundle = YomuStorage.exportAllData();
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        a.href = url;
        a.download = `yomu-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        this.showToast('バックアップを書き出しました');
    },

    async importBackup(input) {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        let bundle;
        try {
            bundle = JSON.parse(await file.text());
        } catch (e) {
            this.alert('バックアップファイルが読み取れません（JSON 不正）', '読み込み失敗');
            return;
        }
        const replace = await this.confirm(
            '既存のデータを上書きして読み込みますか？（キャンセルで併合）',
            'バックアップ読み込み');
        const mode = replace ? 'replace' : 'merge';
        const result = YomuStorage.importAllData(bundle, mode);
        if (!result.ok) {
            console.warn('[Backup] partial import errors:', result.errors);
            this.alert(`一部のデータを読み込めませんでした: ${result.errors.join(', ')}`, '読み込み警告');
        } else {
            this.showToast(mode === 'replace' ? 'データを復元しました' : 'データを併合しました');
        }
        // 导入会改变 settings/syncedBooks/进度等全局状态；
        // 各模块（阅读器书单、统计、书签）均有内存态，最可靠的恢复是重启页面。
        this.toggleSettings();
        setTimeout(() => location.reload(), 700);
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

        // Font pair (漢字/かな別指定；旧 'font' 設定は両スロットへ移行)
        this._initFontUI();
        this.setFontPair(settings.fontKanji || settings.font || 'mincho',
                         settings.fontKana || settings.font || 'mincho',
                         { silent: true });

        // Font size / line height / margin
        if (settings.fontSize) {
            const slider = document.getElementById('font-size-slider');
            if (slider) slider.value = settings.fontSize;
            this.setFontSize(settings.fontSize);
        }

        if (settings.lineHeight) {
            const slider = document.getElementById('line-height-slider');
            if (slider) slider.value = Math.round(settings.lineHeight * 10);
            this.setLineHeight(Math.round(settings.lineHeight * 10));
        }

        this.setMargin(settings.readerMargin || 24);

        // Theme / brightness
        this.setTheme(settings.theme || 'light');
        this.setBrightness(settings.brightness || 100);

        // B5: JLPT 難度表示（默认开）
        const jlptToggle = document.getElementById('jlpt-show-toggle');
        if (jlptToggle) jlptToggle.checked = settings.jlptShow !== false;

        // 自動スクロール速度
        const speedSelect = document.getElementById('autoscroll-speed-select');
        if (speedSelect && speedSelect.setValue) speedSelect.setValue(settings.autoScrollSpeed || 'normal');

        // Furigana Mode
        let furiMode = settings.furiganaMode || 'none';
        if (furiMode === 'nlp' && !YomuTokenizer.isDictAvailable()) {
            furiMode = 'internal';
            YomuStorage.saveSetting('furiganaMode', furiMode);
        }
        const furiSelect = document.getElementById('furigana-mode-select');
        if (furiSelect && furiSelect.setValue) furiSelect.setValue(furiMode);

        document.body.classList.toggle('show-furigana', furiMode !== 'none');

        // 自绘下拉组件初始化（替代原生 select）
        this._initPopSelects();
    },

    setFuriganaMode(mode) {
        if (mode === 'nlp' && !YomuTokenizer.isDictAvailable()) {
            // Revert selection temporarily to avoid showing empty results
            const settings = YomuStorage.getSettings();
            const furiSelect = document.getElementById('furigana-mode-select');
            if (furiSelect && furiSelect.setValue) furiSelect.setValue(settings.furiganaMode || 'internal');

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
        if (!furiSelect || !furiSelect._ypOptions) return;

        const dictReady = YomuTokenizer.isDictAvailable();
        const nlpOption = furiSelect._ypOptions.find(o => o.value === 'nlp');
        if (nlpOption) {
            nlpOption.label = dictReady ? 'Kuromoji.js' : 'Kuromoji.js（未ダウンロード）';
            furiSelect.setValue(furiSelect._ypValue);
        }
    },

    // 自绘下拉：初始化设置面板内的选择器（ふりがな / 自动滚动 / AI 提供方）
    _initPopSelects() {
        if (!window.YomuPop) return;

        const furiHost = document.getElementById('furigana-mode-select');
        if (furiHost && !furiHost._ypInit) {
            furiHost._ypInit = true;
            YomuPop.select({
                trigger: furiHost,
                options: [
                    { value: 'none', label: '不表示' },
                    { value: 'internal', label: '内置' },
                    { value: 'nlp', label: 'Kuromoji.js' }
                ],
                value: YomuStorage.getSettings().furiganaMode || 'internal',
                onChange: (v) => this.setFuriganaMode(v)
            });
            this._updateNlpOptionState();
        }

        const speedHost = document.getElementById('autoscroll-speed-select');
        if (speedHost && !speedHost._ypInit) {
            speedHost._ypInit = true;
            YomuPop.select({
                trigger: speedHost,
                options: [
                    { value: 'slow', label: '遅い' },
                    { value: 'normal', label: '普通' },
                    { value: 'fast', label: '速い' }
                ],
                value: YomuStorage.getSettings().autoScrollSpeed || 'normal',
                onChange: (v) => this.setAutoScrollSpeed(v)
            });
        }

        const aiHost = document.getElementById('ai-provider-select');
        if (aiHost && !aiHost._ypInit) {
            aiHost._ypInit = true;
            YomuPop.select({
                trigger: aiHost,
                options: [
                    { value: 'zhipu', label: '智谱AI (GLM)' },
                    { value: 'kimi', label: 'Kimi (Moonshot)' },
                    { value: 'ark', label: '火山ARK' },
                    { value: 'custom', label: '自定义 / 本地代理' }
                ],
                value: (window.YomuAI && YomuAI.getConfig() && YomuAI.getConfig().provider) || 'zhipu',
                onChange: (v) => this.onAiProviderChange(v)
            });
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
