/**
 * Yomu Dictionary - Offline Japanese-English dictionary
 * Contains common words for reading classic Japanese literature
 */
const YomuDict = {
    _data: null,
    _ready: false,

    async init() {
        try {
            const resp = await fetch('data/dict/jmdict.json');
            if (resp.ok) {
                this._data = await resp.json();
                this._ready = true;
                return true;
            }
        } catch (e) {
            console.warn('Dictionary load failed, using built-in fallback');
        }
        // Fallback: use built-in minimal dict
        this._data = {};
        this._ready = true;
        return false;
    },

    lookup(surface, reading) {
        if (!this._data || !surface) return null;

        // Try exact match on surface form
        let entry = this._data[surface];
        if (!entry && reading) {
            entry = this._data[reading];
        }
        if (!entry) {
            // Try common variations
            const base = surface.replace(/^(お|ご)/, '');
            entry = this._data[base];
        }

        if (entry) {
            if (Array.isArray(entry)) {
                return entry[0]; // Return first match
            }
            return entry;
        }
        return null;
    },

    // Look up by lemma (base form from tokenizer)
    lookupByLemma(lemma, reading) {
        if (!this._data) return null;
        let entry = this._data[lemma];
        if (!entry && reading) {
            entry = this._data[reading];
        }
        if (entry && Array.isArray(entry)) {
            return entry[0];
        }
        return entry || null;
    }
};
