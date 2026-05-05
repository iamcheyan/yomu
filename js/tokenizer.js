/**
 * Yomu Tokenizer - kuromoji.js wrapper for Japanese text analysis
 */
const YomuTokenizer = {
    _tokenizer: null,
    _ready: false,

    async init() {
        const paths = [
            'libs/dict',
            'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/'
        ];

        for (const dicPath of paths) {
            try {
                const tokenizer = await new Promise((resolve, reject) => {
                    kuromoji.builder({ dicPath }).build((err, t) => {
                        if (err) reject(err);
                        else resolve(t);
                    });
                });
                this._tokenizer = tokenizer;
                this._ready = true;
                return;
            } catch (e) {
                console.warn(`Failed to load tokenizer from ${dicPath}:`, e);
            }
        }
        
        throw new Error('All tokenizer initialization attempts failed.');
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
     * @param {boolean} forceAuto - whether to force kuromoji for all kanji
     * @returns {string} HTML with ruby tags and word-token spans
     */
    renderParagraph(text, forceAuto = false) {
        if (!text) return `<p>${text}</p>`;

        // Hybrid Mode: Preserve Aozora markers and fill gaps with NLP
        if (forceAuto) {
            return this._renderHybridParagraph(text);
        }

        // Standard Aozora mode
        if (text.includes('《') || text.includes('［＃')) {
            return this._renderAozoraParagraph(text);
        }
        
        return this._renderKuromojiParagraph(text, false);
    },

    /**
     * Hybrid Rendering: Use Aozora markers where present, NLP for the rest
     */
    _renderHybridParagraph(text) {
        let html = '';
        let lastIndex = 0;
        const regex = /｜([^｜《》]+)《([^》]+)》|([一-鿿々〆〇]+)《([^》]+)》|※(［＃[^］]+］)|(［＃「([^」]+)」に傍点］)|(［＃[^］]+］)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            // Text before this marker - process with NLP
            const before = text.slice(lastIndex, match.index);
            if (before) {
                // Tokenize and add furigana to all kanji in the 'before' block
                html += this._renderKuromojiParagraph(before, true, true);
            }

            // Handle the matched marker (Same as _renderAozoraParagraph)
            if (match[1] !== undefined) {
                html += this._makeRuby(match[1], this._kataToHira(match[2]));
            } else if (match[3] !== undefined) {
                html += this._makeRuby(match[3], this._kataToHira(match[4]));
            } else if (match[5] !== undefined) {
                const desc = match[5].replace(/^［＃|］$/g, '');
                html += `<span class="gaiji-badge">${this._escapeHtml(desc)}</span>`;
            } else if (match[8] !== undefined) {
                const note = match[8].replace(/^［＃|］$/g, '');
                // 过滤掉纯布局、分页、样式类的标注，这些不应作为注脚显示
                const isLayoutNote = note.match(/字下げ|字上げ|地から|改頁|見出し|改段|中見出し|大見出し|小見出し|改丁|太字|斜体|窓書き/);
                if (!isLayoutNote) {
                    html += `<span class="annotation-wrapper"><span class="annotation-icon">㊟</span><span class="annotation-content">${this._escapeHtml(note)}</span></span>`;
                }
            }
            lastIndex = match.index + match[0].length;
        }

        const after = text.slice(lastIndex);
        if (after) {
            html += this._renderKuromojiParagraph(after, true, true);
        }

        if (!html.trim()) return '';
        return `<p>${html}</p>`;
    },

    /**
     * Parse Aozora Bunko format: ruby 《》｜ and annotations ［＃...］
     */
    _renderAozoraParagraph(text) {
        let html = '';
        let lastIndex = 0;

        // Check for indentation at paragraph start
        let indentMatch = text.match(/^［＃(\d+)字下げ］/);
        let prefix = '';
        if (indentMatch) {
            const indent = parseInt(indentMatch[1]);
            prefix = ` style="text-indent:${indent}em"`;
            lastIndex = indentMatch[0].length;
        }

        // Combined regex for all markers
        const regex = /｜([^｜《》]+)《([^》]+)》|([一-鿿々〆〇]+)《([^》]+)》|※(［＃[^］]+］)|(［＃「([^」]+)」に傍点］)|(［＃[^］]+］)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            // Text before this marker
            const before = text.slice(lastIndex, match.index);
            if (before) html += this._escapeHtml(before);

            if (match[1] !== undefined) {
                // ｜...《...》 - explicit ruby
                const kanji = match[1];
                const reading = this._kataToHira(match[2]);
                html += this._makeRuby(kanji, reading);
            } else if (match[3] !== undefined) {
                // 漢字《かな》 - implicit ruby
                const kanji = match[3];
                const reading = this._kataToHira(match[4]);
                html += this._makeRuby(kanji, reading);
            } else if (match[5] !== undefined) {
                // ※［＃...］ - 外字 (character description)
                const desc = match[5].replace(/^［＃|］$/g, '');
                html += `<span class="gaiji-badge">${this._escapeHtml(desc)}</span>`;
            } else if (match[6] !== undefined) {
                // ［＃「...」に傍点］ - emphasis dots
                const word = match[7];
                // Find and wrap the matching text before this annotation
                const precedingText = text.slice(lastIndex, match.index);
                const wordIndex = precedingText.lastIndexOf(word);
                if (wordIndex >= 0) {
                    // Re-render: text before word + emphasized word + text after word
                    const beforeWord = precedingText.slice(0, wordIndex);
                    const afterWord = precedingText.slice(wordIndex + word.length);
                    if (beforeWord) html += this._escapeHtml(beforeWord);
                    html += `<em class="bōten">${this._escapeHtml(word)}</em>`;
                    if (afterWord) html += this._escapeHtml(afterWord);
                } else {
                    // Can't find the word, just show the annotation
                    html += `<span class="annotation-wrapper"><span class="annotation-icon">㊟</span><span class="annotation-content">${this._escapeHtml(word)}</span></span>`;
                }
            } else if (match[8] !== undefined) {
                // Other annotations - show as inline badge
                const note = match[8].replace(/^［＃|］$/g, '');
                // Skip layout notes (X字下げ, 地から etc) - they're handled above or ignored
                if (!note.match(/字下げ|字上げ|地から/)) {
                    html += `<span class="annotation-wrapper"><span class="annotation-icon">㊟</span><span class="annotation-content">${this._escapeHtml(note)}</span></span>`;
                }
            }

            lastIndex = match.index + match[0].length;
        }

        // Remaining text
        const after = text.slice(lastIndex);
        if (after) html += this._escapeHtml(after);

        if (!html.trim()) return '';
        return `<p${prefix}>${html}</p>`;
    },

    _kataToHira(str) {
        return str.replace(/[ァ-ヶ]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) - 0x60)
        );
    },

    _makeRuby(kanji, reading) {
        return `<ruby class="word-token has-furigana" data-surface="${this._escapeAttr(kanji)}" data-reading="${this._escapeAttr(reading)}">${this._escapeHtml(kanji)}<rt>${this._escapeHtml(reading)}</rt></ruby>`;
    },

    /**
     * Render using kuromoji auto-tokenization (fallback)
     */
    _renderKuromojiParagraph(text, forceAllFurigana = false, isInline = false) {
        if (!this._ready) return this._escapeHtml(text);
        
        const tokens = this.tokenize(text);
        let html = isInline ? '' : '<p>';

        for (const token of tokens) {
            const surface = token.surface_form;
            if (/^\s+$/.test(surface)) {
                html += surface;
                continue;
            }

            const lemma = this.getLemma(token);
            const reading = this.getHiragana(token);
            let needsRuby = this.needsRuby(token);
            
            // If Full Furigana is ON, force ruby for all Kanji
            if (forceAllFurigana && /[一-鿿]/.test(surface)) {
                needsRuby = true;
            }

            const pos = token.pos;
            const posDetail = token.pos_detail_1;
            const dataAttrs = `data-surface="${this._escapeAttr(surface)}" data-lemma="${this._escapeAttr(lemma)}" data-reading="${this._escapeAttr(reading)}" data-pos="${this._escapeAttr(pos)}" data-pos-detail="${this._escapeAttr(posDetail)}"`;

            if (needsRuby) {
                html += `<ruby class="word-token has-furigana" ${dataAttrs}>${this._escapeHtml(surface)}<rt>${this._escapeHtml(reading)}</rt></ruby>`;
            } else if (this.isContentWord(token)) {
                html += `<span class="word-token" ${dataAttrs}>${this._escapeHtml(surface)}</span>`;
            } else {
                html += `<span ${dataAttrs}>${this._escapeHtml(surface)}</span>`;
            }
        }

        if (isInline) return html;
        // Strip <p> and check content
        const content = html.substring(3); 
        if (!content.trim()) return '';
        
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
