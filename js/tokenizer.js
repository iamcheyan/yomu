/**
 * Yomu Tokenizer - kuromoji.js wrapper for Japanese text analysis
 */
const YomuTokenizer = {
    _tokenizer: null,
    _ready: false,

    async init() {
        return new Promise((resolve, reject) => {
            kuromoji.builder({ dicPath: 'libs/dict' }).build((err, tokenizer) => {
                if (err) {
                    console.error('Tokenizer init failed:', err);
                    reject(err);
                    return;
                }
                this._tokenizer = tokenizer;
                this._ready = true;
                resolve();
            });
        });
    },

    isReady() {
        return this._ready;
    },

    /**
     * Tokenize a text string and return tokens with ruby info
     * @param {string} text - Japanese text
     * @returns {Array} tokens
     */
    tokenize(text) {
        if (!this._tokenizer) return [];
        return this._tokenizer.tokenize(text);
    },

    /**
     * Check if a token needs ruby annotation
     * A token needs ruby if it contains kanji and has a different reading
     */
    needsRuby(token) {
        if (!token || !token.surface_form) return false;
        const surface = token.surface_form;
        const reading = token.reading;
        // Has kanji characters
        const hasKanji = /[一-鿿]/.test(surface);
        if (!hasKanji) return false;
        // Reading differs from surface (means kanji needs annotation)
        if (reading && reading !== surface) return true;
        return false;
    },

    /**
     * Get the hiragana reading for a token
     */
    getHiragana(token) {
        if (!token || !token.reading) return '';
        // kuromoji returns katakana reading, convert to hiragana
        return this.katakanaToHiragana(token.reading);
    },

    katakanaToHiragana(str) {
        return str.replace(/[ァ-ヶ]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) - 0x60)
        );
    },

    /**
     * Get the lemma (base/dictionary form) of a token
     */
    getLemma(token) {
        if (!token) return '';
        return token.basic_form === '*' ? token.surface_form : token.basic_form;
    },

    /**
     * Get part of speech in Japanese
     */
    getPOS(token) {
        if (!token) return '';
        const pos = token.pos;
        const posDetail = token.pos_detail_1;
        const map = {
            '名詞': '名詞',
            '動詞': '動詞',
            '形容詞': '形容詞',
            '副詞': '副詞',
            '助詞': '助詞',
            '助動詞': '助動詞',
            '接続詞': '接続詞',
            '感動詞': '感動詞',
            '連体詞': '連体詞',
            '接頭詞': '接頭詞',
            '記号': '記号',
            'フィラー': 'フィラー',
            'その他': 'その他'
        };
        return map[pos] || pos;
    },

    /**
     * Get POS in English for dictionary display
     */
    getPOSEnglish(token) {
        if (!token) return '';
        const map = {
            '名詞': 'noun',
            '動詞': 'verb',
            '形容詞': 'adjective',
            '副詞': 'adverb',
            '助詞': 'particle',
            '助動詞': 'auxiliary',
            '接続詞': 'conjunction',
            '感動詞': 'interjection',
            '連体詞': 'adnominal',
            '接頭詞': 'prefix',
            '記号': 'symbol',
            'フィラー': 'filler',
            'その他': 'other'
        };
        return map[token.pos] || token.pos;
    },

    /**
     * Check if token is a content word (not function word)
     */
    isContentWord(token) {
        if (!token) return false;
        const skip = ['助詞', '助動詞', '記号', '接続詞', 'フィラー', 'その他'];
        return !skip.includes(token.pos);
    },

    /**
     * Render a paragraph with ruby annotations and clickable tokens
     * @param {string} text - raw text paragraph (may contain Aozora 《》｜ ruby)
     * @returns {string} HTML with ruby tags and word-token spans
     */
    renderParagraph(text) {
        if (!text) return `<p>${text}</p>`;

        // If text has Aozora ruby markers, use them (more accurate than kuromoji)
        if (text.includes('《')) {
            return this._renderAozoraParagraph(text);
        }

        // Otherwise fall back to kuromoji auto-ruby
        if (!this._ready) return `<p>${this._escapeHtml(text)}</p>`;
        return this._renderKuromojiParagraph(text);
    },

    /**
     * Parse Aozora Bunko ruby format: 漢字《かな》 and ｜漢字《かな》
     */
    _renderAozoraParagraph(text) {
        let html = '<p>';
        // Process ｜ marker first (explicit ruby start), then 《》 pairs
        // Pattern: optional ｜, then kanji/text, then 《reading》
        const regex = /｜?([^\｜《》]+?)《([^》]+)》/g;
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
            // Text before this ruby
            const before = text.slice(lastIndex, match.index);
            if (before) html += this._escapeHtml(before);

            const kanji = match[1];
            const reading = match[2];
            // Convert katakana reading to hiragana for display
            const hiragana = reading.replace(/[ァ-ヶ]/g, ch =>
                String.fromCharCode(ch.charCodeAt(0) - 0x60)
            );

            html += `<ruby class="word-token has-furigana" data-surface="${this._escapeAttr(kanji)}" data-reading="${this._escapeAttr(hiragana)}">${this._escapeHtml(kanji)}<rp>(</rp><rt>${this._escapeHtml(hiragana)}</rt><rp>)</rp></ruby>`;
            lastIndex = match.index + match[0].length;
        }

        // Remaining text after last ruby
        const after = text.slice(lastIndex);
        if (after) html += this._escapeHtml(after);

        html += '</p>';
        return html;
    },

    /**
     * Render using kuromoji auto-tokenization (fallback)
     */
    _renderKuromojiParagraph(text) {
        const tokens = this.tokenize(text);
        let html = '<p>';

        for (const token of tokens) {
            const surface = token.surface_form;
            if (/^\s+$/.test(surface)) {
                html += surface;
                continue;
            }

            const lemma = this.getLemma(token);
            const reading = this.getHiragana(token);
            const needsRuby = this.needsRuby(token);
            const pos = token.pos;
            const posDetail = token.pos_detail_1;

            const dataAttrs = `data-surface="${this._escapeAttr(surface)}" data-lemma="${this._escapeAttr(lemma)}" data-reading="${this._escapeAttr(reading)}" data-pos="${this._escapeAttr(pos)}" data-pos-detail="${this._escapeAttr(posDetail)}"`;

            if (needsRuby) {
                html += `<ruby class="word-token has-furigana" ${dataAttrs}>${this._escapeHtml(surface)}<rp>(</rp><rt>${this._escapeHtml(reading)}</rt><rp>)</rp></ruby>`;
            } else if (this.isContentWord(token)) {
                html += `<span class="word-token" ${dataAttrs}>${this._escapeHtml(surface)}</span>`;
            } else {
                html += `<span ${dataAttrs}>${this._escapeHtml(surface)}</span>`;
            }
        }

        html += '</p>';
        return html;
    },

    _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    _escapeAttr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};
