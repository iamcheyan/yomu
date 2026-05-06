/**
 * Yomu Tokenizer - kuromoji.js wrapper for Japanese text analysis
 */
const YomuTokenizer = {
    _tokenizer: null,
    _ready: false,
    _dictPath: null,

    DICT_FILES: [
        'base.dat.gz', 'cc.dat.gz', 'check.dat.gz',
        'tid.dat.gz', 'tid_map.dat.gz', 'tid_pos.dat.gz',
        'unk.dat.gz', 'unk_char.dat.gz', 'unk_compat.dat.gz',
        'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz'
    ],

    CDN_BASE: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/',

    async init() {
        const isAndroid = !!window.YomuNative;

        // Android must only use user-downloaded dictionaries. Web can use bundled assets/CDN.
        const paths = [];
        if (isAndroid) {
            const extPath = window.YomuNative.getExternalPath() + '/dict';
            paths.push(extPath);
        } else {
            paths.push('libs/dict');
            paths.push(this.CDN_BASE);
        }

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
                this._dictPath = dicPath;
                console.log('[Tokenizer] Loaded from:', dicPath);
                return;
            } catch (e) {
                console.warn(`[Tokenizer] Failed from ${dicPath}:`, e);
            }
        }

        console.warn('[Tokenizer] All paths failed. Kuromoji unavailable.');
    },

    /**
     * Check if dictionary is available locally (not CDN)
     */
    isDictAvailable() {
        if (!window.YomuNative) return this._ready;
        return this.DICT_FILES.every(file => window.YomuNative.fileExists('dict/' + file));
    },

    /**
     * Check if tokenizer is ready
     */
    isReady() {
        return this._ready;
    },

    /**
     * Download dictionary files to external storage
     * @param {function} onProgress - callback(overallPercent, currentFilename, filePercent)
     * @param {function} onComplete - callback(successCount, totalCount)
     * @param {function} onError - callback(filename, errorMsg)
     */
    downloadDict(onProgress, onComplete, onError) {
        if (!window.YomuNative) {
            if (onError) onError('*', 'Not on Android');
            return;
        }

        const total = this.DICT_FILES.length;
        let completed = 0;
        let failed = 0;
        const fileProgress = {};

        // Initialize progress for all files
        for (const file of this.DICT_FILES) {
            fileProgress[file] = 0;
        }

        const updateOverallProgress = (filename, progress) => {
            if (progress >= 0) fileProgress[filename] = progress;

            // Calculate overall progress: (sum of all file progress) / total
            let totalProgress = 0;
            for (const file of this.DICT_FILES) {
                totalProgress += fileProgress[file];
            }
            const overallPercent = Math.round(totalProgress / total);

            if (onProgress) onProgress(overallPercent, filename, progress);
        };

        window.YomuNativeCallback = {
            onDownloadProgress: (filename, progress, downloaded) => {
                updateOverallProgress(filename, progress);
            },
            onDownloadComplete: (filename) => {
                completed++;
                fileProgress[filename] = 100;
                updateOverallProgress(filename, 100);

                console.log(`[Tokenizer] Downloaded ${filename} (${completed + failed}/${total})`);

                if (completed + failed >= total) {
                    const finalSuccessCount = completed;
                    delete window.YomuNativeCallback;
                    if (onComplete) onComplete(finalSuccessCount, total);
                }
            },
            onDownloadError: (filename, error) => {
                failed++;
                console.error(`[Tokenizer] Download failed: ${filename} - ${error}`);
                if (onError) onError(filename, error);

                if (completed + failed >= total) {
                    const finalSuccessCount = completed;
                    delete window.YomuNativeCallback;
                    if (onComplete) onComplete(finalSuccessCount, total);
                }
            }
        };

        // Start downloads
        for (const file of this.DICT_FILES) {
            const url = this.CDN_BASE + file;
            window.YomuNative.downloadFile(url, 'dict/' + file);
        }
    },

    /**
     * Reinitialize after dictionary download
     */
    async reinit() {
        this._ready = false;
        this._tokenizer = null;
        await this.init();
    },

    tokenize(text) {
        if (!this._tokenizer) return [];
        return this._tokenizer.tokenize(text);
    },

    needsRuby(token) {
        if (!token || !token.surface_form) return false;
        const surface = token.surface_form;
        const reading = token.reading;
        const hasKanji = /[一-鿿]/.test(surface);
        if (!hasKanji) return false;
        if (reading && reading !== surface) return true;
        return false;
    },

    getHiragana(token) {
        if (!token || !token.reading) return '';
        return this.katakanaToHiragana(token.reading);
    },

    katakanaToHiragana(str) {
        return str.replace(/[ァ-ヶ]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) - 0x60)
        );
    },

    getLemma(token) {
        if (!token) return '';
        return token.basic_form === '*' ? token.surface_form : token.basic_form;
    },

    getPOS(token) {
        if (!token) return '';
        const pos = token.pos;
        const map = {
            '名詞': '名詞', '動詞': '動詞', '形容詞': '形容詞',
            '副詞': '副詞', '助詞': '助詞', '助動詞': '助動詞',
            '接続詞': '接続詞', '感動詞': '感動詞', '連体詞': '連体詞',
            '接頭詞': '接頭詞', '記号': '記号', 'フィラー': 'フィラー',
            'その他': 'その他'
        };
        return map[pos] || pos;
    },

    getPOSEnglish(token) {
        if (!token) return '';
        const map = {
            '名詞': 'noun', '動詞': 'verb', '形容詞': 'adjective',
            '副詞': 'adverb', '助詞': 'particle', '助動詞': 'auxiliary',
            '接続詞': 'conjunction', '感動詞': 'interjection',
            '連体詞': 'adnominal', '接頭詞': 'prefix', '記号': 'symbol',
            'フィラー': 'filler', 'その他': 'other'
        };
        return map[token.pos] || token.pos;
    },

    isContentWord(token) {
        if (!token) return false;
        const skip = ['助詞', '助動詞', '記号', '接続詞', 'フィラー', 'その他'];
        return !skip.includes(token.pos);
    },

    renderParagraph(text, forceAuto = false) {
        if (!text) return `<p>${text}</p>`;
        if (forceAuto) return this._renderHybridParagraph(text);
        if (text.includes('《') || text.includes('［＃')) return this._renderAozoraParagraph(text);
        return this._renderKuromojiParagraph(text, false);
    },

    _renderHybridParagraph(text) {
        let html = '';
        let lastIndex = 0;
        const regex = /｜([^｜《》]+)《([^》]+)》|([一-鿿々〆〇]+)《([^》]+)》|※(［＃[^］]+］)|(［＃「([^」]+)」に傍点］)|(［＃[^］]+］)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const before = text.slice(lastIndex, match.index);
            if (before) html += this._renderKuromojiParagraph(before, true, true);

            if (match[1] !== undefined) {
                html += this._makeRuby(match[1], this._kataToHira(match[2]));
            } else if (match[3] !== undefined) {
                html += this._makeRuby(match[3], this._kataToHira(match[4]));
            } else if (match[5] !== undefined) {
                const desc = match[5].replace(/^［＃|］$/g, '');
                html += `<span class="gaiji-badge">${this._escapeHtml(desc)}</span>`;
            } else if (match[8] !== undefined) {
                const note = match[8].replace(/^［＃|］$/g, '');
                const isLayoutNote = note.match(/字下げ|字上げ|地から|改頁|見出し|改段|中見出し|大見出し|小見出し|改丁|太字|斜体|窓書き/);
                if (!isLayoutNote) {
                    html += `<span class="annotation-wrapper"><span class="annotation-icon">㊟</span><span class="annotation-content">${this._escapeHtml(note)}</span></span>`;
                }
            }
            lastIndex = match.index + match[0].length;
        }

        const after = text.slice(lastIndex);
        if (after) html += this._renderKuromojiParagraph(after, true, true);
        if (!html.trim()) return '';
        return `<p>${html}</p>`;
    },

    _renderAozoraParagraph(text) {
        let html = '';
        let lastIndex = 0;

        let indentMatch = text.match(/^［＃(\d+)字下げ］/);
        let prefix = '';
        if (indentMatch) {
            const indent = parseInt(indentMatch[1]);
            prefix = ` style="--indent:${indent}em" class="u-indent"`;
            lastIndex = indentMatch[0].length;
        }

        const regex = /｜([^｜《》]+)《([^》]+)》|([一-鿿々〆〇]+)《([^》]+)》|※(［＃[^］]+］)|(［＃「([^」]+)」に傍点］)|(［＃[^］]+］)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const before = text.slice(lastIndex, match.index);
            if (before) html += this._escapeHtml(before);

            if (match[1] !== undefined) {
                html += this._makeRuby(match[1], this._kataToHira(match[2]));
            } else if (match[3] !== undefined) {
                html += this._makeRuby(match[3], this._kataToHira(match[4]));
            } else if (match[5] !== undefined) {
                const desc = match[5].replace(/^［＃|］$/g, '');
                html += `<span class="gaiji-badge">${this._escapeHtml(desc)}</span>`;
            } else if (match[6] !== undefined) {
                const word = match[7];
                const precedingText = text.slice(lastIndex, match.index);
                const wordIndex = precedingText.lastIndexOf(word);
                if (wordIndex >= 0) {
                    const beforeWord = precedingText.slice(0, wordIndex);
                    const afterWord = precedingText.slice(wordIndex + word.length);
                    if (beforeWord) html += this._escapeHtml(beforeWord);
                    html += `<em class="bōten">${this._escapeHtml(word)}</em>`;
                    if (afterWord) html += this._escapeHtml(afterWord);
                } else {
                    html += `<span class="annotation-wrapper"><span class="annotation-icon">㊟</span><span class="annotation-content">${this._escapeHtml(word)}</span></span>`;
                }
            } else if (match[8] !== undefined) {
                const note = match[8].replace(/^［＃|］$/g, '');
                if (!note.match(/字下げ|字上げ|地から/)) {
                    html += `<span class="annotation-wrapper"><span class="annotation-icon">㊟</span><span class="annotation-content">${this._escapeHtml(note)}</span></span>`;
                }
            }
            lastIndex = match.index + match[0].length;
        }

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
        const content = html.substring(3);
        if (!content.trim()) return '';
        html += '</p>';
        return html;
    },

    renderPureFurigana(text) {
        if (!this._ready) return this._escapeHtml(text);
        const tokens = this.tokenize(text);
        let html = '';

        for (const token of tokens) {
            const surface = token.surface_form;
            if (/^\s+$/.test(surface)) {
                html += surface;
                continue;
            }
            const needsRuby = /[一-鿿]/.test(surface) && token.pos !== '記号';
            if (needsRuby) {
                const reading = this.getHiragana(token);
                html += `<ruby>${this._escapeHtml(surface)}<rt>${this._escapeHtml(reading)}</rt></ruby>`;
            } else {
                html += this._escapeHtml(surface);
            }
        }
        return html;
    },

    renderPureHybridFurigana(text) {
        let html = '';
        let lastIndex = 0;
        const regex = /｜([^｜《》]+)《([^》]+)》|([一-鿿々〆〇]+)《([^》]+)》|※(［＃[^］]+］)|(［＃「([^」]+)」に傍点］)|(［＃[^］]+］)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const before = text.slice(lastIndex, match.index);
            if (before) html += this.renderPureFurigana(before);

            if (match[1] !== undefined) {
                html += `<ruby>${this._escapeHtml(match[1])}<rt>${this._escapeHtml(this._kataToHira(match[2]))}</rt></ruby>`;
            } else if (match[3] !== undefined) {
                html += `<ruby>${this._escapeHtml(match[3])}<rt>${this._escapeHtml(this._kataToHira(match[4]))}</rt></ruby>`;
            }
            lastIndex = match.index + match[0].length;
        }

        const after = text.slice(lastIndex);
        if (after) html += this.renderPureFurigana(after);
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
