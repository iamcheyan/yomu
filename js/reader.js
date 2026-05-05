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
                // Fallback to static files (Use XHR for better compatibility on Android file://)
                data = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', `data/novels/${bookId}.json`, true);
                    xhr.onload = () => {
                        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                            try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
                        } else { reject(new Error(`XHR failed: ${xhr.status}`)); }
                    };
                    xhr.onerror = () => reject(new Error('Network Error'));
                    xhr.send();
                }).catch(() => null);
            }

            if (!data) throw new Error('Book not found');

            this._currentBookData = data;
            this._renderBook(data);
        } catch (e) {
            console.error('Failed to load book:', e);
            Yomu.alert('書籍の読み込みに失敗しました。', 'エラー');
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

        // Mark vocab words
        this._refreshVocabMarks();

        // Restore scroll position (Prioritize precise scrollTop, fallback to percentage)
        const progress = YomuStorage.getProgress(bookId);
        if (progress) {
            setTimeout(() => {
                if (progress.scrollTop) {
                    window.scrollTo(0, progress.scrollTop);
                } else if (progress.scrollPercent > 0) {
                    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                    window.scrollTo(0, maxScroll * progress.scrollPercent / 100);
                }
            }, 100);
        }

        this._startProgressTracking();
    },

    _renderBook(data) {
        const container = document.getElementById('novel-content');
        let html = '';

        const settings = YomuStorage.getSettings();
        const forceAuto = settings.autoFurigana === true;

        this._translations = data.translations || [];

        if (data.chapters) {
            let paraIndex = 0;
            for (const chapter of data.chapters) {
                if (chapter.title) {
                    html += `<h2 class="chapter-title">${this._escapeHtml(chapter.title)}</h2>`;
                }
                for (const para of chapter.paragraphs) {
                    html += this._renderParaWithTranslation(para, paraIndex, forceAuto);
                    paraIndex++;
                }
            }
        } else if (data.paragraphs) {
            for (let i = 0; i < data.paragraphs.length; i++) {
                html += this._renderParaWithTranslation(data.paragraphs[i], i, forceAuto);
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

    _renderParaWithTranslation(text, index, forceAuto) {
        let html = YomuTokenizer.renderParagraph(text, forceAuto);
        const translations = this._translations && this._translations[index];
        const hasTranslation = Array.isArray(translations) && translations.length > 0;

        // Count how many translations we have
        const transCount = hasTranslation ? translations.length : 0;
        const iconTitle = hasTranslation ? `${transCount}件の翻訳あり` : '翻訳なし';

        // Append translation icon before closing </p>
        const iconHtml = `<span class="trans-icon${hasTranslation ? '' : ' disabled'}" 
                             data-para-index="${index}" 
                             title="${iconTitle}" 
                             onclick="Yomu.reader.toggleTranslation(${index})">
                             译${transCount > 1 ? transCount : ''}
                         </span>`;

        html = html.replace(/<\/p>$/, `${iconHtml}</p>`);

        // Add the container for translation text
        html += `<div class="translation-line hidden" id="trans-${index}"></div>`;
        return html;
    },

    toggleTranslation(index) {
        const el = document.getElementById(`trans-${index}`);
        if (!el) return;

        // If already visible, hide it
        if (!el.classList.contains('hidden')) {
            el.classList.add('hidden');
            return;
        }

        const translations = this._translations && this._translations[index];
        if (!Array.isArray(translations) || translations.length === 0) {
            console.log(`No translations for paragraph ${index}`);
            return;
        }

        // Build beautiful translation list
        let html = '';
        for (const t of translations) {
            const modelLabel = t.model_name || t.model || 'AI';
            html += `<div class="trans-item">
                <div class="trans-meta">
                    <span class="trans-model">${this._escapeHtml(modelLabel)}</span>
                </div>
                <div class="trans-text">${this._escapeHtml(t.text)}</div>
            </div>`;
        }

        el.innerHTML = html;
        el.classList.remove('hidden');

        // Optional: scroll into view if it's too long
        // el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
                    YomuStorage.saveProgress(this._currentBook.id, percent, scrollTop);
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
