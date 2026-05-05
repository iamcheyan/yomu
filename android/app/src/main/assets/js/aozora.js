/**
 * Yomu Aozora - Fetcher and parser for Aozora Bunko text files
 */
const YomuAozora = {
    BASE_URL: 'https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/',

    /**
     * Fetch and process a book from Aozora Bunko
     */
    async downloadBook(bookMeta) {
        const { authorId, workId, fileId } = bookMeta;
        const url = `${this.BASE_URL}${authorId}/files/${fileId}/${fileId}.txt`;

        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Failed to fetch book from Aozora Bunko');
            const rawText = await resp.text();

            // Process the text
            const processed = this.parseAozora(rawText, bookMeta);
            return processed;
        } catch (e) {
            console.error('Aozora download failed:', e);
            throw e;
        }
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
            // Usually [header, body, footer]
            content = parts[1].trim();
        } else {
            // Fallback: try to find the first blank line after metadata
            content = text;
        }

        // 2. Remove Aozora notes [＃...]
        content = content.replace(/［＃[^］]+］/g, '');

        // 3. Handle Ruby
        // Current implementation: Strip Aozora ruby and let Kuromoji handle it
        // This ensures consistent look across all books.
        content = content.replace(/《[^》]+》/g, '');
        content = content.replace(/｜/g, ''); // Remove ruby start marker

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
