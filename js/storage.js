/**
 * Yomu Storage - External storage primary, localStorage fallback
 * On Android: reads/writes to /sdcard/Yomu/data/ via YomuNative bridge
 * On Web: uses localStorage and IndexedDB as before
 */
const YomuStorage = {
    PREFIX: 'yomu_',
    _extCache: {},      // Cache of data loaded from external storage
    _isAndroid: false,
    _progressTimer: null,

    /**
     * Initialize storage: load from external storage if available
     */
    async init() {
        this._isAndroid = !!window.YomuNative;
        if (!this._isAndroid) return;

        // Load persistent data from external storage
        const keys = ['settings', 'progress', 'downloaded_books'];
        for (const key of keys) {
            try {
                const json = window.YomuNative.readFile(key + '.json');
                if (json) {
                    const data = JSON.parse(json);
                    this._extCache[key] = data;
                    // Also sync to localStorage for fast access
                    localStorage.setItem(this.PREFIX + key, JSON.stringify(data));
                    console.log(`[Storage] Loaded ${key} from external storage`);
                }
            } catch (e) {
                console.warn(`[Storage] Failed to load ${key} from external:`, e);
            }
        }
    },

    get(key, defaultVal) {
        try {
            // External cache takes priority on Android
            if (this._isAndroid && this._extCache[key] !== undefined) {
                return this._extCache[key];
            }
            const val = localStorage.getItem(this.PREFIX + key);
            return val !== null ? JSON.parse(val) : defaultVal;
        } catch (e) {
            return defaultVal;
        }
    },

    set(key, val) {
        try {
            // Update cache
            if (this._isAndroid) {
                this._extCache[key] = val;
            }
            // Always write to localStorage (fast, synchronous)
            localStorage.setItem(this.PREFIX + key, JSON.stringify(val));
            // Async write to external storage
            if (this._isAndroid) {
                this._syncToExt(key, val);
            }
        } catch (e) {
            console.warn('Storage save failed:', e);
        }
    },

    _syncToExt(key, val) {
        try {
            window.YomuNative.saveFile(key + '.json', JSON.stringify(val));
        } catch (e) {
            console.warn(`[Storage] External sync failed for ${key}:`, e);
        }
    },

    remove(key) {
        localStorage.removeItem(this.PREFIX + key);
        if (this._isAndroid) {
            delete this._extCache[key];
            try { window.YomuNative.deleteFile(key + '.json'); } catch (e) {}
        }
    },

    // ===== Reading Progress =====
    getProgress(bookId) {
        const all = this.get('progress', {});
        return all[bookId] || { scrollPercent: 0, lastRead: null };
    },

    saveProgress(bookId, scrollPercent, scrollTop, paraIndex) {
        const progress = this.get('progress', {});
        progress[bookId] = {
            scrollPercent,
            scrollTop,
            paraIndex,
            lastRead: Date.now()
        };
        // Always update localStorage immediately
        localStorage.setItem(this.PREFIX + 'progress', JSON.stringify(progress));
        if (this._isAndroid) {
            this._extCache.progress = progress;
            // Debounce external writes (progress updates frequently during scroll)
            if (this._progressTimer) clearTimeout(this._progressTimer);
            this._progressTimer = setTimeout(() => {
                this._syncToExt('progress', progress);
            }, 3000);
        }
    },

    // ===== App State =====
    getAppState() {
        return this.get('app_state', { lastView: 'library', lastBookId: null });
    },

    saveAppState(state) {
        const current = this.getAppState();
        const updated = { ...current, ...state };
        this.set('app_state', updated);
    },

    // ===== Settings =====
    getSettings() {
        return this.get('settings', {
            fontSize: 20,
            lineHeight: 2.2,
            font: 'mincho',
            furiganaMode: 'nlp',
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

        // 2. If on Android, also save to external storage
        if (window.YomuNative) {
            try {
                window.YomuNative.saveFile('novels/' + bookId + '.json', JSON.stringify(data));
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

        // 2. Fallback to Android external storage
        if (!data && window.YomuNative) {
            try {
                const json = window.YomuNative.readFile('novels/' + bookId + '.json');
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

    // ===== Local library management =====
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
