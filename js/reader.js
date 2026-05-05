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
        
        // 首次加载渲染
        this._renderNextChunk();
        
        // 恢复进度
        const progress = YomuStorage.getProgress(bookId);
        if (progress && progress.paraIndex) {
            // 如果有保存的段落索引，我们需要预加载到那个位置
            while (this._renderedCount <= progress.paraIndex && this._renderedCount < this._paragraphs.length) {
                this._renderNextChunk();
            }
            // 滚动到该段落 (简单起见先滚到那个索引对应的元素)
            const el = document.getElementById(`p-${progress.paraIndex}`);
            if (el) {
                el.scrollIntoView();
            }
            
            // 立即更新进度条 UI
            const percent = this._paragraphs.length > 0 ? Math.round((progress.paraIndex / this._paragraphs.length) * 100) : 0;
            this._updateProgressUI(percent);
        } else {
            window.scrollTo(0, 0);
            this._updateProgressUI(0);
        }

        // 初始化无限滚动监听
        this._initInfiniteScroll();
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
                html += this._renderParaWithTranslation(para.content, i, forceAuto);
            }
        }
        
        const temp = document.createElement('div');
        temp.innerHTML = html;
        while (temp.firstChild) {
            container.appendChild(temp.firstChild);
        }
        
        this._renderedCount = end;
        
        // Attach click handlers to word tokens
        this._attachWordClickHandlers(container);
        
        // 如果还有内容，添加或移动哨兵节点
        this._updateSentinel();
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

    _initEvents() {
        this._initGestures();
        this._startProgressTracking();
    },

    _startProgressTracking() {
        if (this._scrollListener) {
            window.removeEventListener('scroll', this._scrollListener);
        }

        this._scrollListener = () => {
            // 找到视口顶部的元素 (偏移 100px 避开边缘)
            const topEl = document.elementFromPoint(window.innerWidth / 2, 100);
            let paraIndex = 0;
            
            if (topEl) {
                // 找到最近的带有 p- 索引 ID 的段落或标题
                const pEl = topEl.closest('[id^="p-"]');
                if (pEl) {
                    paraIndex = parseInt(pEl.id.split('-')[1]);
                }
            }

            const total = this._paragraphs.length;
            const percent = total > 0 ? Math.round((paraIndex / total) * 100) : 0;
            
            // 实时更新进度条 UI
            const zenFill = document.getElementById('zen-progress-fill');
            if (zenFill) zenFill.style.width = `${percent}%`;

            // 防抖保存到存储 (500ms)
            if (this._scrollTimeout) clearTimeout(this._scrollTimeout);
            this._scrollTimeout = setTimeout(() => {
                if (this._currentBook) {
                    // 同时保存百分比、高度和段落索引
                    YomuStorage.saveProgress(this._currentBook.id, percent, window.scrollY, paraIndex);
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
