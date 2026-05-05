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
                xhr.open('GET', 'data/books.json', true);
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

        // Load book data
        let bookData = await YomuStorage.getBookContent(bookId);
        if (!bookData) {
            try {
                bookData = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', `data/novels/${bookId}.json`, true);
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
                Yomu.alert('書籍の読み込みに失敗しました。', 'エラー');
                return;
            }
        }

        if (!bookData) {
            Yomu.alert('書籍の読み込みに失敗しました。', 'エラー');
            return;
        }

        this._currentBookData = bookData;

        // Update UI
        document.getElementById('reader-title').textContent = book.title;
        document.getElementById('reader-author').textContent = book.author;

        // Render all content
        this._renderBook(bookData);

        // Show reader view
        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('vocab-view').classList.add('hidden');
        document.getElementById('reader-view').classList.add('active');
        document.getElementById('bottom-bar').style.display = 'flex';

        // Restore scroll progress
        const progress = YomuStorage.getProgress(bookId);
        if (progress && progress.scrollTop) {
            setTimeout(() => window.scrollTo(0, progress.scrollTop), 50);
        } else {
            window.scrollTo(0, 0);
        }

        // Start progress tracking
        this._startProgressTracking();
    },

    _renderBook(bookData) {
        const container = document.getElementById('novel-content');
        let html = '';

        if (bookData.chapters) {
            for (const chapter of bookData.chapters) {
                if (chapter.title) {
                    html += `<h2 class="chapter-title">${this._escapeHtml(chapter.title)}</h2>`;
                }
                for (const para of chapter.paragraphs) {
                    if (para && para.trim()) {
                        html += this._renderPara(para);
                    }
                }
            }
        } else if (bookData.paragraphs) {
            for (const para of bookData.paragraphs) {
                if (para && para.trim()) {
                    html += this._renderPara(para);
                }
            }
        }

        container.innerHTML = html;
    },

    _renderPara(text) {
        // 处理青空文库的假名标记: 漢字《かな》 → <ruby>漢字<rt>かな</rt></ruby>
        let html = this._escapeHtml(text);

        // ｜明示标记：｜漢字《かな》
        html = html.replace(/｜([^｜《》]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');

        // 漢字《かな》（汉字后直接跟标注）
        html = html.replace(/([一-鿿々〆〇]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');

        // 清理青空文库的排版指令 ［＃...］
        html = html.replace(/［＃[^］]*］/g, '');

        return `<p class="novel-para">${html}</p>`;
    },

    reRender() {
        if (this._currentBookData) {
            const scrollY = window.scrollY;
            this._renderBook(this._currentBookData);
            window.scrollTo(0, scrollY);
        }
    },

    _startProgressTracking() {
        if (this._scrollListener) {
            window.removeEventListener('scroll', this._scrollListener);
        }

        this._scrollListener = () => {
            const scrollTop = window.scrollY;
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            const percent = maxScroll > 0 ? Math.round(scrollTop / maxScroll * 100) : 0;

            // Update Zen progress bar
            const zenFill = document.getElementById('zen-progress-fill');
            if (zenFill) zenFill.style.width = `${percent}%`;

            // Debounced save
            if (this._scrollTimeout) clearTimeout(this._scrollTimeout);
            this._scrollTimeout = setTimeout(() => {
                if (this._currentBook) {
                    YomuStorage.saveProgress(this._currentBook.id, percent, scrollTop);
                }
            }, 500);
        };
        window.addEventListener('scroll', this._scrollListener);
    },



    /**
     * Pinch-to-zoom gesture for font size
     */
    _initGestures() {
        let initialDist = 0;
        let initialFontSize = 0;
        let isPinching = false;
        
        // Target the main scrollable area or the body
        const container = document.body;

        container.addEventListener('touchstart', (e) => {
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
    }
};
