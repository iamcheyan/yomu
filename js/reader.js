/**
 * Yomu Reader - Core reading view logic
 */
const YomuReader = {
    _currentBook: null,
    _books: [],
    _scrollTimer: null,

    async init() {
        try {
            const resp = await fetch('data/books.json');
            if (resp.ok) {
                this._books = await resp.json();
            }
        } catch (e) {
            console.error('Failed to load book list:', e);
        }
    },

    getBooks() {
        return this._books;
    },

    async openBook(bookId) {
        const book = this._books.find(b => b.id === bookId);
        if (!book) return;

        this._currentBook = book;

        // Load book data
        try {
            let data = await YomuStorage.getBookContent(bookId);
            
            if (!data) {
                // Fallback to static files
                const resp = await fetch(`data/novels/${bookId}.json`);
                if (resp.ok) {
                    data = await resp.json();
                }
            }

            if (!data) throw new Error('Book not found');
            
            this._currentBookData = data;
            this._renderBook(data);
        } catch (e) {
            console.error('Failed to load book:', e);
            alert('書籍の読み込みに失敗しました。');
            return;
        }

        // Update UI
        document.getElementById('reader-title').textContent = book.title;
        document.getElementById('reader-author').textContent = book.author;

        // Show reader view
        document.getElementById('book-list-view').classList.add('hidden');
        document.getElementById('vocab-view').classList.add('hidden');
        document.getElementById('reader-view').classList.add('active');
        document.getElementById('bottom-bar').style.display = 'flex';

        // Restore scroll position
        const progress = YomuStorage.getProgress(bookId);
        if (progress.scrollPercent > 0) {
            requestAnimationFrame(() => {
                const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                window.scrollTo(0, maxScroll * progress.scrollPercent / 100);
            });
        }

        // Track scroll for progress
        this._startProgressTracking();

        // Mark vocab words
        this._refreshVocabMarks();
    },

    _renderBook(data) {
        const container = document.getElementById('novel-content');
        let html = '';
        
        const settings = YomuStorage.getSettings();
        const forceAuto = settings.autoFurigana === true;

        if (data.chapters) {
            for (const chapter of data.chapters) {
                if (chapter.title) {
                    html += `<h2 class="chapter-title">${this._escapeHtml(chapter.title)}</h2>`;
                }
                for (const para of chapter.paragraphs) {
                    html += YomuTokenizer.renderParagraph(para, forceAuto);
                }
            }
        } else if (data.paragraphs) {
            for (const para of data.paragraphs) {
                html += YomuTokenizer.renderParagraph(para, forceAuto);
            }
        }

        container.innerHTML = html;

        // Attach click handlers to word tokens
        container.querySelectorAll('.word-token').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                this._onWordClick(el);
            });
        });
    },

    reRender() {
        if (this._currentBookData) {
            this._renderBook(this._currentBookData);
            // Scroll to current position to avoid jumping
            this._refreshVocabMarks();
        }
    },

    _onWordClick(el) {
        const surface = el.dataset.surface;
        const lemma = el.dataset.lemma;
        const reading = el.dataset.reading;
        const pos = el.dataset.pos;
        const posDetail = el.dataset.posDetail;

        // Look up in dictionary
        let dictEntry = YomuDict.lookupByLemma(lemma, reading);
        if (!dictEntry) {
            dictEntry = YomuDict.lookup(surface, reading);
        }

        // Build popup content
        const displayWord = surface !== lemma ? `${surface}（${lemma}）` : surface;
        const displayReading = reading || '';
        const displayPOS = YomuTokenizer.getPOSEnglish({ pos, pos_detail_1: posDetail }) || pos;
        const meaning = dictEntry ? (typeof dictEntry === 'string' ? dictEntry : dictEntry.m || dictEntry.meaning || '') : '';

        document.getElementById('popup-word').textContent = displayWord;
        document.getElementById('popup-reading').textContent = displayReading;
        document.getElementById('popup-pos').textContent = displayPOS;
        document.getElementById('popup-meaning').textContent = meaning || '辞書に登録がありません。';

        // Update mark button
        const isMarked = YomuStorage.isMarked(lemma || surface, reading);
        const btn = document.getElementById('btn-mark-word');
        btn.textContent = isMarked ? '単語帳から削除' : '単語帳に追加';
        btn.dataset.surface = surface;
        btn.dataset.lemma = lemma;
        btn.dataset.reading = reading;
        btn.dataset.meaning = meaning;
        btn.dataset.pos = displayPOS;
        btn.dataset.bookId = this._currentBook ? this._currentBook.id : '';

        // Show popup
        document.getElementById('popup-overlay').classList.remove('hidden');
        document.getElementById('popup-card').classList.remove('hidden');
    },

    _startProgressTracking() {
        if (this._scrollTimer) {
            window.removeEventListener('scroll', this._scrollTimer);
        }

        this._scrollTimer = () => {
            clearTimeout(this._scrollTimer);
            this._scrollTimer = setTimeout(() => {
                const scrollTop = window.scrollY;
                const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                const percent = maxScroll > 0 ? Math.round(scrollTop / maxScroll * 100) : 0;

                document.getElementById('progress-text').textContent = percent + '%';

                if (this._currentBook) {
                    YomuStorage.saveProgress(this._currentBook.id, percent);
                }
            }, 200);
        };

        window.addEventListener('scroll', this._scrollTimer);
    },

    scrollTop() {
        window.scrollTo({ top: 0 });
    },

    _refreshVocabMarks() {
        document.querySelectorAll('.word-token.marked').forEach(el => {
            el.classList.remove('marked');
        });

        const vocab = YomuStorage.getVocab();
        document.querySelectorAll('.word-token').forEach(el => {
            const lemma = el.dataset.lemma;
            const reading = el.dataset.reading;
            if (vocab.some(v => v.word === lemma && v.reading === reading)) {
                el.classList.add('marked');
            }
        });
    },

    refreshMarks() {
        this._refreshVocabMarks();
    },

    getCurrentBook() {
        return this._currentBook;
    },

    _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};
