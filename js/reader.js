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
        const forceAuto = settings.furiganaMode === 'nlp';

        this._translations = data.translations || [];

        if (data.chapters) {
            let paraIndex = 0;
            for (const chapter of data.chapters) {
                if (chapter.title) {
                    html += `<h2 class="chapter-title">${this._escapeHtml(chapter.title)}</h2>`;
                }
                for (const para of chapter.paragraphs) {
                    if (para && para.trim()) {
                        html += this._renderParaWithTranslation(para, paraIndex, forceAuto);
                    }
                    paraIndex++;
                }
            }
        } else if (data.paragraphs) {
            for (let i = 0; i < data.paragraphs.length; i++) {
                const para = data.paragraphs[i];
                if (para && para.trim()) {
                    html += this._renderParaWithTranslation(para, i, forceAuto);
                }
            }
        }

        container.innerHTML = html;

        // Initialize lazy loading for NLP mode
        if (forceAuto) {
            this._initLazyLoading();
        } else {
            // Attach click handlers to word tokens (already rendered in standard mode)
            this._attachWordClickHandlers(container);
        }
    },

    _initLazyLoading() {
        const options = {
            rootMargin: '400px 0px', // 提前 400 像素开始加载
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const text = el.dataset.text;
                    const index = parseInt(el.dataset.index);
                    
                    // Render actual content with NLP
                    const html = YomuTokenizer.renderParagraph(text, true);
                    
                    // Extract icons and translations if any (we kept them in the placeholder)
                    const icon = el.querySelector('.trans-icon');
                    const iconHtml = icon ? icon.outerHTML : '';
                    
                    // Update innerHTML
                    // renderParagraph returns <p>...</p>, we just want the inner part
                    const innerHtml = html.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '');
                    el.innerHTML = innerHtml + iconHtml;
                    el.classList.remove('lazy-para');
                    el.classList.add('rendered-para');
                    
                    // Attach click handlers to new tokens
                    this._attachWordClickHandlers(el);
                    
                    // Stop observing once rendered
                    observer.unobserve(el);
                }
            });
        }, options);

        document.querySelectorAll('.lazy-para').forEach(el => observer.observe(el));
    },

    _attachWordClickHandlers(container) {
        container.querySelectorAll('.word-token').forEach(el => {
            // Avoid duplicate listeners
            if (el.dataset.listenerAttached) return;
            el.addEventListener('click', (e) => {
                e.preventDefault();
                this._onWordClick(el);
            });
            el.dataset.listenerAttached = 'true';
        });
    },

    _renderParaWithTranslation(text, index, forceAuto) {
        const translations = this._translations && this._translations[index];
        const hasTranslation = Array.isArray(translations) && translations.some(t => t && t.text && t.text.trim().length > 0);
        const validTranslations = hasTranslation ? translations.filter(t => t && t.text && t.text.trim().length > 0) : [];
        const transCount = validTranslations.length;
        const iconTitle = `${transCount}件の翻訳あり`;

        let iconHtml = '';
        if (hasTranslation) {
            iconHtml = `<span class="trans-icon" 
                                 data-para-index="${index}" 
                                 title="${iconTitle}" 
                                 onclick="Yomu.reader.toggleTranslation(${index})">
                                 译${transCount > 1 ? transCount : ''}
                             </span>`;
        }

        if (forceAuto) {
            // Lazy mode: render placeholder
            return `<p class="lazy-para" data-index="${index}" data-text="${this._escapeAttr(text)}">
                        ${this._escapeHtml(text)}${iconHtml}
                    </p>
                    <div class="translation-line hidden" id="trans-${index}"></div>`;
        }

        // Standard mode: render immediately
        let html = YomuTokenizer.renderParagraph(text, false);
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
        const hasTrans = Array.isArray(translations) && translations.length > 0;
        
        // Hide icon if no translation exists
        const iconHtml = hasTrans ? `
            <span class="trans-icon" data-para-index="${index}" title="${translations.length}件の翻訳あり" onclick="Yomu.reader.toggleTranslation(${index})">
                译
            </span>
        ` : '';
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
        
        // Detailed metadata
        const metaEl = document.getElementById('popup-meta');
        let metaHtml = '';
        if (lemma && lemma !== surface) metaHtml += `<div class="popup-meta-item"><strong>原形:</strong> ${this._escapeHtml(lemma)}</div>`;
        if (posDetail && posDetail !== '*') metaHtml += `<div class="popup-meta-item"><strong>細分類:</strong> ${this._escapeHtml(posDetail)}</div>`;
        metaEl.innerHTML = metaHtml;
        metaEl.style.display = metaHtml ? 'block' : 'none';

        const meaningEl = document.getElementById('popup-meaning');
        meaningEl.textContent = meaning;
        meaningEl.style.display = meaning ? 'block' : 'none';

        // Update mark button
        const isMarked = YomuStorage.isMarked(lemma || surface, reading);
        const btn = document.getElementById('btn-mark-word');
        btn.textContent = isMarked ? '単語帳から削除' : '単語帳に追加';
        btn.dataset.surface = surface;
        btn.dataset.lemma = lemma;
        btn.dataset.reading = reading;
        btn.dataset.meaning = meaning;
        btn.dataset.pos = displayPOS;
        btn.dataset.posDetail = posDetail || '';
        btn.dataset.bookId = this._currentBook ? this._currentBook.id : '';

        // Show popup
        document.getElementById('popup-overlay').classList.remove('hidden');
        document.getElementById('popup-card').classList.remove('hidden');
    },

    _startProgressTracking() {
        if (this._scrollListener) {
            window.removeEventListener('scroll', this._scrollListener);
        }

        this._scrollListener = () => {
            if (this._scrollTimeout) clearTimeout(this._scrollTimeout);
            this._scrollTimeout = setTimeout(() => {
                const scrollTop = window.scrollY;
                const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                const percent = maxScroll > 0 ? Math.round(scrollTop / maxScroll * 100) : 0;
                
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
