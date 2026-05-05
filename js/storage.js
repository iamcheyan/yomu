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

    saveProgress(bookId, scrollPercent, scrollTop) {
        const all = this.get('progress', {});
        all[bookId] = { scrollPercent, scrollTop, lastRead: Date.now() };
        this.set('progress', all);
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

    addVocab(word, reading, meaning, pos, bookId) {
        const vocab = this.getVocab();
        const exists = vocab.find(v => v.word === word && v.reading === reading);
        if (exists) return false;
        vocab.unshift({ word, reading, meaning, pos, bookId, addedAt: Date.now() });
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
            furigana: true
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
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this._STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this._STORE_NAME);
            const request = store.put(data, bookId);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    },

    async getBookContent(bookId) {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this._STORE_NAME], 'readonly');
            const store = transaction.objectStore(this._STORE_NAME);
            const request = store.get(bookId);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e);
        });
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
            books.push(bookMeta);
            this.set('downloaded_books', books);
        }
    }
};
