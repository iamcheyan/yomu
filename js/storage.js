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

    saveProgress(bookId, scrollPercent) {
        const all = this.get('progress', {});
        all[bookId] = { scrollPercent, lastRead: Date.now() };
        this.set('progress', all);
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
    }
};
