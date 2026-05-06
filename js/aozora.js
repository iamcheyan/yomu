/**
 * Yomu Aozora - Fetcher and parser for Aozora Bunko text files
 */
const YomuAozora = {
    BASE_URL: 'https://raw.githubusercontent.com/iamcheyan/yomu/main/data/novels/',
    GITHUB_RAW: 'https://raw.githubusercontent.com/iamcheyan/yomu/main/data/novels/',

    async downloadBook(bookMeta) {
        const bookId = bookMeta.id || bookMeta.fileId || bookMeta.workId;
        const localUrl = `data/novels/${bookId}.json`;
        const remoteUrl = `${this.GITHUB_RAW}${bookId}.json`;

        if (!window.YomuNative) {
            try {
                console.log(`[Aozora] Loading local book: ${bookId} from ${localUrl}`);
                return await this._fetchBookJson(localUrl);
            } catch (e) {
                console.warn(`[Aozora] Local book load failed, falling back to GitHub: ${bookId}`, e);
            }
        }

        console.log(`[Aozora] Loading remote book: ${bookId} from ${remoteUrl}`);
        return this._fetchBookJson(remoteUrl);
    },

    async _fetchBookJson(url) {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch book JSON: ${url} (HTTP ${response.status})`);
        }

        return response.json();
    },

    /**
     * Parse Aozora Bunko markup
     * 1. Remove header and footer
     * 2. Remove notes [＃...]
     * 3. Strip ruby 《...》 or convert them if needed
     * 4. Split into paragraphs
     */
    parseAozora(text, meta) {
        // 1. Split by separator (usually a line of '-------------------------------------------------------')
        // Aozora files usually have header, then separator, then body, then separator, then footer.
        let parts = text.split(/^-{5,}/m);
        
        let content = '';
        if (parts.length >= 3) {
            // Standard Aozora: [Title/Author, Symbol Notes, Body, Footer]
            // We want the Body (parts[2])
            content = parts[2].trim();
        } else if (parts.length === 2) {
            // Fallback for files with only one separator: [Header, Body]
            content = parts[1].trim();
        } else {
            // Last resort: find first blank line after metadata block
            content = text.replace(/^[\s\S]*?\r?\n\r?\n/, '').trim();
        }

        // 2. Remove Aozora notes [＃...]
        // Keep them for tokenizer.js to handle properly (it knows how to parse them)
        
        // 3. Handle Ruby
        // We no longer strip ruby here. We keep them as ｜...《...》 or ...《...》
        // so that tokenizer.js can render them correctly in "Internal" mode.

        // 4. Split into paragraphs
        const lines = content.split(/\r?\n/);
        const paragraphs = [];
        let currentPara = '';

        for (let line of lines) {
            line = line.trim();
            if (line === '') {
                if (currentPara) {
                    paragraphs.push(currentPara);
                    currentPara = '';
                }
            } else {
                currentPara += line;
            }
        }
        if (currentPara) paragraphs.push(currentPara);

        return {
            id: meta.id,
            title: meta.title,
            author: meta.author,
            year: meta.year || '',
            paragraphs: paragraphs
        };
    }
};
