/**
 * Yomu Reader - Core reading view logic
 */
const YomuReader = {
    _currentBook: null,
    _books: [],
    _scrollTimer: null,

    async init() {
        try {
            console.log('Loading book catalog...');
            // In Android, fetch on file:// can be tricky, try XHR as fallback
            const data = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', 'data/books.json?t=' + Date.now(), true);
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

            if (data && Array.isArray(data)) {
                let books = data;
                // Merge synced books from storage
                const settings = YomuStorage.getSettings();
                if (settings.syncedBooks && Array.isArray(settings.syncedBooks)) {
                    for (const sb of settings.syncedBooks) {
                        if (!books.find(b => b.id === sb.id)) {
                            books.push(sb);
                        }
                    }
                }
                this._books = books;
                console.log(`Loaded ${this._books.length} books.`);
            }
        } catch (e) {
            console.error('Failed to load book list:', e);
            // Last resort: hardcoded sample if everything fails
            if (this._books.length === 0) {
                this._books = [
                    { id: "rashomon", title: "羅生門", author: "芥川龍之介", desc: "加载失败，请检查资源。" }
                ];
            }
        }
        
        // Initialize gestures
        this._initGestures();
    },

    getBooks() {
        return this._books;
    },

    async openBook(bookId) {
        let book = this._books.find(b => b.id === bookId);
        if (!book) {
            book = YomuStorage.getDownloadedBooks().find(b => b.id === bookId);
        }
        if (!book) return;

        this._currentBook = book;
        const targetFileId = book.fileId || bookId;

        // Load book data
        let bookData = await YomuStorage.getBookContent(targetFileId);
        if (!bookData) {
            try {
                bookData = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', `data/novels/${targetFileId}.json`, true);
                    xhr.onload = () => {
                        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                            try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
                        } else { reject(new Error(`XHR failed: ${xhr.status}`)); }
                    };
                    xhr.onerror = () => reject(new Error('Network Error'));
                    xhr.send();
                });
            } catch (e) {
                console.error('Failed to load book:', e);
                return false;
            }
        }
        
        if (!bookData) {
            return false;
        }

        this._currentBookData = bookData;

        // Update UI
        document.getElementById('reader-title').textContent = book.title;
        document.getElementById('reader-author').textContent = book.author;
        
        // Update Status Bar
        const statusTitle = document.getElementById('status-title');
        const statusAuthor = document.getElementById('status-author');
        if (statusTitle) statusTitle.textContent = book.title;
        if (statusAuthor) statusAuthor.textContent = book.author;
        this._renderBookFrontmatter(book, bookData);

        // Flatten book content into paragraphs
        this._paragraphs = [];
        if (bookData.chapters) {
            for (const chapter of bookData.chapters) {
                if (chapter.title) {
                    this._paragraphs.push({ type: 'header', content: chapter.title });
                }
                for (const para of chapter.paragraphs) {
                    if (para && para.trim()) {
                        this._paragraphs.push({ type: 'text', content: para });
                    }
                }
            }
        } else if (bookData.paragraphs) {
            for (const para of bookData.paragraphs) {
                if (para && para.trim()) {
                    this._paragraphs.push({ type: 'text', content: para });
                }
            }
        }

        this._renderedCount = 0;
        this._chunkSize = 50;
        this._furiganaQueue = [];
        document.getElementById('novel-content').innerHTML = '';

        // Show reader view
        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('store-view').classList.add('hidden');
        document.getElementById('reader-view').classList.add('active');

        // Initial render chunk
        this._renderNextChunk();

        // Restore scroll progress (before starting infinite scroll observer)
        const progress = YomuStorage.getProgress(bookId);
        if (progress && progress.paraIndex) {
            while (this._renderedCount <= progress.paraIndex && this._renderedCount < this._paragraphs.length) {
                this._renderNextChunk();
            }
            const el = document.getElementById(`p-${progress.paraIndex}`);
            if (el) {
                // Use instant scroll to avoid triggering observer during animation
                el.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
            const percent = this._paragraphs.length > 0 ? Math.round((progress.paraIndex / this._paragraphs.length) * 100) : 0;
            this._updateProgressUI(percent);
        } else {
            window.scrollTo(0, 0);
            this._updateProgressUI(0);
        }

        // Start infinite scroll & tracking AFTER scroll restoration is complete
        requestAnimationFrame(() => {
            this._initInfiniteScroll();
            this._startProgressTracking();
            this._startFuriganaProcessor();
        });

        return true;
    },

    _renderBookFrontmatter(book, bookData) {
        const container = document.getElementById('book-frontmatter');
        if (!container) return;

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

        const desc = bookData.desc || book.desc || '';
        const cardLink = info.cardUrl
            ? `<a class="frontmatter-link" href="${this._escapeAttr(info.cardUrl)}" target="_blank" rel="noopener noreferrer">青空文庫 図書カード</a>`
            : '';

        container.innerHTML = `
            ${desc ? `<p class="frontmatter-desc">${this._escapeHtml(desc)}</p>` : ''}
            ${rows.length ? `<section class="frontmatter-section"><h2>作品情報</h2><div class="frontmatter-grid">${rows.join('')}</div>${cardLink}</section>` : ''}
            <div class="frontmatter-start">本文</div>
        `;
    },

    _renderNextChunk() {
        const container = document.getElementById('novel-content');
        const start = this._renderedCount;
        const end = Math.min(start + this._chunkSize, this._paragraphs.length);
        
        const settings = YomuStorage.getSettings();
        const forceAuto = settings.furiganaMode === 'nlp';

        let html = '';
        for (let i = start; i < end; i++) {
            const para = this._paragraphs[i];
            if (para.type === 'header') {
                html += `<h2 class="chapter-title" id="p-${i}">${this._escapeHtml(para.content)}</h2>`;
            } else {
                html += this._renderPara(para.content, i);
                
                // If NLP furigana is enabled, queue it for background processing
                if (forceAuto) {
                    this._furiganaQueue.push({ index: i, text: para.content });
                }
            }
        }
        
        const temp = document.createElement('div');
        temp.innerHTML = html;
        while (temp.firstChild) {
            container.appendChild(temp.firstChild);
        }
        
        this._renderedCount = end;
        this._updateSentinel();
    },

    _startFuriganaProcessor() {
        if (this._furiganaInterval) clearInterval(this._furiganaInterval);
        
        this._furiganaInterval = setInterval(() => {
            // Check if queue has items and Kuromoji is ready
            if (!this._furiganaQueue || this._furiganaQueue.length === 0) return;
            if (typeof YomuTokenizer === 'undefined' || !YomuTokenizer._ready) return;

            // Process a small batch to avoid UI blocking (5 paras per 100ms)
            const batch = this._furiganaQueue.splice(0, 5);
            for (const item of batch) {
                const el = document.getElementById(`p-${item.index}`);
                if (el) {
                    const icon = el.querySelector('.trans-icon');
                    el.innerHTML = YomuTokenizer.renderPureHybridFurigana(item.text);
                    if (icon) el.appendChild(icon);
                }
            }
        }, 100);
    },

    _updateSentinel() {
        let sentinel = document.getElementById('render-sentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'render-sentinel';
            sentinel.classList.add('reader-sentinel');
            document.getElementById('novel-content').appendChild(sentinel);
        } else {
            document.getElementById('novel-content').appendChild(sentinel);
        }

        if (this._renderedCount >= this._paragraphs.length) {
            sentinel.classList.add('hidden');
        } else {
            sentinel.classList.remove('hidden');
        }
    },

    _initInfiniteScroll() {
        if (this._observer) this._observer.disconnect();
        
        this._observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && this._renderedCount < this._paragraphs.length) {
                this._renderNextChunk();
            }
        }, { rootMargin: '400px' });

        const sentinel = document.getElementById('render-sentinel');
        if (sentinel) this._observer.observe(sentinel);
    },

    _renderPara(text, index) {
        // 处理青空文库的假名标记: 漢字《かな》 → <ruby>漢字<rt>かな</rt></ruby>
        let html = this._escapeHtml(text);

        // ｜明示标记：｜漢字《かな》
        html = html.replace(/｜([^｜《》]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');

        // 漢字《かな》（汉字后直接跟标注）
        html = html.replace(/([一-鿿々〆〇]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');

        // 清理青空文库的排版指令 ［＃...］
        html = html.replace(/［＃[^］]*］/g, '');

        let transIcon = '';
        const trans = this._currentBookData.translations ? this._currentBookData.translations[index] : null;
        if (trans && trans.length > 0) {
            const count = trans.length;
            transIcon = `<span class="trans-icon" data-para-index="${index}" title="${count}件の翻訳あり" onclick="Yomu.reader.toggleTranslation(${index})">訳</span>`;
        }

        return `<p class="novel-para" id="p-${index}">${html}${transIcon}</p>`;
    },

    reRender() {
        if (this._currentBook) {
            const topEl = document.elementFromPoint(window.innerWidth / 2, 100);
            let currentParaIndex = 0;
            if (topEl) {
                const pEl = topEl.closest('[id^="p-"]');
                if (pEl) currentParaIndex = parseInt(pEl.id.split('-')[1]);
            }

            this._renderedCount = 0;
            document.getElementById('novel-content').innerHTML = '';
            
            while (this._renderedCount <= currentParaIndex && this._renderedCount < this._paragraphs.length) {
                this._renderNextChunk();
            }

            const el = document.getElementById(`p-${currentParaIndex}`);
            if (el) el.scrollIntoView();
        }
    },

    _updateProgressUI(percent) {
        const statusProgress = document.getElementById('status-progress');
        if (statusProgress) statusProgress.textContent = `${percent}%`;
    },

    _startProgressTracking() {
        if (this._scrollListener) {
            window.removeEventListener('scroll', this._scrollListener);
        }

        let lastKnownParaIndex = 0;

        this._scrollListener = () => {
            // Check if at the very top
            if (window.scrollY <= 5) {
                this._updateProgressUI(0);
                if (window.Yomu && typeof Yomu.updateReaderControlsAvailability === 'function') {
                    Yomu.updateReaderControlsAvailability();
                }
                if (this._currentBook) {
                    YomuStorage.saveProgress(this._currentBook.id, 0, 0, 0);
                }
                return;
            }

            // Find the topmost visible paragraph to calculate accurate progress
            const paragraphs = document.querySelectorAll('#novel-content [id^="p-"]');
            let currentParaIndex = lastKnownParaIndex;
            
            // Find the first paragraph that is visible at the top of the viewport
            for (let i = 0; i < paragraphs.length; i++) {
                const p = paragraphs[i];
                const rect = p.getBoundingClientRect();
                // If the top of the paragraph is within the top half of the screen
                // or if it's a large paragraph and we are currently inside it.
                if (rect.bottom > 100) {
                    const idNum = parseInt(p.id.split('-')[1]);
                    if (!isNaN(idNum)) {
                        currentParaIndex = idNum;
                    }
                    break;
                }
            }

            // If we've reached the very bottom, force 100% if all content is rendered
            const isAtBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 60);
            if (isAtBottom && this._renderedCount >= this._paragraphs.length) {
                currentParaIndex = this._paragraphs.length;
                if (window.Yomu &&
                    typeof Yomu.updateReaderControlsAvailability === 'function' &&
                    typeof Yomu.setReaderControlsVisible === 'function') {
                    Yomu.updateReaderControlsAvailability();
                    Yomu.setReaderControlsVisible(true);
                }
            }
            
            lastKnownParaIndex = currentParaIndex;

            const total = this._paragraphs.length;
            const percent = total > 0 ? Math.round((currentParaIndex / total) * 100) : 0;
            
            this._updateProgressUI(percent);
            if (window.Yomu && typeof Yomu.updateReaderControlsAvailability === 'function') {
                Yomu.updateReaderControlsAvailability();
            }

            if (this._scrollTimeout) clearTimeout(this._scrollTimeout);
            this._scrollTimeout = setTimeout(() => {
                if (this._currentBook) {
                    // Save both percentage, fallback scroll height, and exact para index
                    YomuStorage.saveProgress(this._currentBook.id, percent, window.scrollY, currentParaIndex);
                }
            }, 500);
        };
        window.addEventListener('scroll', this._scrollListener);
    },



    _initGestures() {
        let initialDist = 0;
        let initialFontSize = 0;
        let isPinching = false;
        
        const container = document.body;
        const readerView = document.getElementById('reader-view');

        container.addEventListener('touchstart', (e) => {
            // Only allow pinch zoom in reader view
            if (!readerView.classList.contains('active')) return;

            if (e.touches.length === 2) {
                isPinching = true;
                initialDist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                initialFontSize = YomuStorage.getSettings().fontSize || 20;
            }
        }, { passive: false });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && isPinching) {
                // Double check active state
                if (!readerView.classList.contains('active')) return;

                // Prevent default browser zoom/scroll
                e.preventDefault();
                
                const currentDist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                
                if (initialDist > 0) {
                    const ratio = currentDist / initialDist;
                    let newSize = Math.round(initialFontSize * ratio);
                    
                    // Constraints
                    if (newSize < 12) newSize = 12;
                    if (newSize > 64) newSize = 64;

                    // Apply in real-time
                    if (window.Yomu && typeof Yomu.setFontSize === 'function') {
                        Yomu.setFontSize(newSize);
                    }
                }
            }
        }, { passive: false });

        container.addEventListener('touchend', (e) => {
            if (e.touches.length < 2) {
                isPinching = false;
                initialDist = 0;
            }
        });
    },

    scrollTop() {
        window.scrollTo({ top: 0 });
    },



    getCurrentBook() {
        return this._currentBook;
    },

    getCurrentBookData() {
        return this._currentBookData;
    },

    _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    _escapeAttr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
    },
    /**
     * Toggle translation visibility for a paragraph
     */
    toggleTranslation(index) {
        const p = document.getElementById(`p-${index}`);
        if (!p) return;

        let transLine = p.nextElementSibling;
        if (transLine && transLine.classList.contains('translation-line')) {
            transLine.remove();
            return;
        }

        // Render translation
        const translations = this._currentBookData.translations[index];
        if (!translations) return;

        transLine = document.createElement('div');
        transLine.className = 'translation-line';
        
        let transHtml = '';
        translations.forEach(t => {
            transHtml += `
                <div class="trans-item">
                    <div class="trans-meta">
                        <span class="trans-model">${t.model_name || t.model}</span>
                    </div>
                    <div class="trans-text">${t.text}</div>
                </div>
            `;
        });
        
        transLine.innerHTML = transHtml;
        p.after(transLine);
    },
};
