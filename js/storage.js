/**
 * Yomu Storage - localStorage wrapper for settings and vocabulary
 */
const YomuStorage = {
    PREFIX: 'yomu_',

    get(key, defaultVal) {
        try {
            const val = localStorage.getItem(this.PREFIX + key);
            return val !== null ? JSON.parse(val) : defaultVal;
        } catch (e) {
            return defaultVal;
        }
    },

    set(key, val) {
        try {
            localStorage.setItem(this.PREFIX + key, JSON.stringify(val));
        } catch (e) {
            console.warn('Storage save failed:', e);
        }
    },

    remove(key) {
        localStorage.removeItem(this.PREFIX + key);
    },

    // Reading progress: { bookId: { scrollPercent, lastRead } }
    getProgress(bookId) {
        const all = this.get('progress', {});
        return all[bookId] || { scrollPercent: 0, lastRead: null };
    },

    saveProgress(bookId, scrollPercent, scrollTop, paraIndex) {
        const progress = JSON.parse(localStorage.getItem('yomu_progress') || '{}');
        progress[bookId] = { 
            scrollPercent, 
            scrollTop, 
            paraIndex,
            lastRead: Date.now() 
        };
        localStorage.setItem('yomu_progress', JSON.stringify(progress));
    },

    // App state: { lastView, lastBookId }
    getAppState() {
        return this.get('app_state', { lastView: 'library', lastBookId: null });
    },

    saveAppState(state) {
        const current = this.getAppState();
        const updated = { ...current, ...state };
        this.set('app_state', updated);
    },

    // Vocabulary list
    getVocab() {
        return this.get('vocab', []);
    },

    addVocab(word, reading, meaning, pos, bookId, lemma, posDetail) {
        const vocab = this.getVocab();
        const exists = vocab.find(v => v.word === word && v.reading === reading);
        if (exists) return false;
        vocab.unshift({ 
            word, 
            reading, 
            meaning, 
            pos, 
            bookId, 
            lemma,
            posDetail,
            addedAt: Date.now() 
        });
        this.set('vocab', vocab);
        return true;
    },

    removeVocab(word, reading) {
        const vocab = this.getVocab().filter(v => !(v.word === word && v.reading === reading));
        this.set('vocab', vocab);
    },

    isMarked(word, reading) {
        return this.getVocab().some(v => v.word === word && v.reading === reading);
    },

    // Settings
    getSettings() {
        return this.get('settings', {
            fontSize: 20,
            lineHeight: 2.2,
            font: 'mincho',
            furiganaMode: 'nlp', // 'none', 'internal', 'nlp'
            noAnimation: true
        });
    },

    saveSetting(key, val) {
        const settings = this.getSettings();
        settings[key] = val;
        this.set('settings', settings);
    },

    // ===== IndexedDB for large book content =====
    _db: null,
    _DB_NAME: 'yomu_db',
    _STORE_NAME: 'books_content',

    async _getDB() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this._DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this._STORE_NAME)) {
                    db.createObjectStore(this._STORE_NAME);
                }
            };
            request.onsuccess = (e) => {
                this._db = e.target.result;
                resolve(this._db);
            };
            request.onerror = (e) => reject(e);
        });
    },

    async saveBookContent(bookId, data) {
        // 1. Always save to IndexedDB (Browser cache)
        const db = await this._getDB();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction([this._STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this._STORE_NAME);
            const request = store.put(data, bookId);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });

        // 2. If on Android, also save to Filesystem (User Home Dir)
        if (window.YomuNative) {
            try {
                window.YomuNative.saveFile(bookId + '.json', JSON.stringify(data));
                console.log('[Storage] Saved to Android filesystem:', bookId);
            } catch (e) {
                console.error('[Storage] Android filesystem save failed:', e);
            }
        }
    },

    async getBookContent(bookId) {
        // 1. Try IndexedDB first
        const db = await this._getDB();
        let data = await new Promise((resolve, reject) => {
            const transaction = db.transaction([this._STORE_NAME], 'readonly');
            const store = transaction.objectStore(this._STORE_NAME);
            const request = store.get(bookId);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e);
        });

        // 2. Fallback to Android filesystem if not in IndexedDB
        if (!data && window.YomuNative) {
            try {
                const json = window.YomuNative.readFile(bookId + '.json');
                if (json) {
                    data = JSON.parse(json);
                    console.log('[Storage] Loaded from Android filesystem:', bookId);
                    // Sync back to IndexedDB for faster future access
                    await this.saveBookContent(bookId, data);
                }
            } catch (e) {
                console.error('[Storage] Android filesystem read failed:', e);
            }
        }
        return data;
    },

    async deleteBookContent(bookId) {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this._STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this._STORE_NAME);
            const request = store.delete(bookId);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    },

    // Local library management (list of downloaded books)
    getDownloadedBooks() {
        return this.get('downloaded_books', []);
    },

    addDownloadedBook(bookMeta) {
        const books = this.getDownloadedBooks();
        if (!books.find(b => b.id === bookMeta.id)) {
            books.unshift(bookMeta);
            this.set('downloaded_books', books);
        }
    },

    removeDownloadedBook(bookId) {
        const books = this.getDownloadedBooks().filter(b => b.id !== bookId);
        this.set('downloaded_books', books);
        this.deleteBookContent(bookId);
    }
};
