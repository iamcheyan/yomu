/**
 * YomuImporter — C1 本地 .txt / .epub 导入
 *
 * 原则:
 *  - 纯 vanilla，无构建、无外部依赖。EPUB 解压用浏览器原生
 *    DecompressionStream('deflate-raw')（Chrome 103+ / 现代 WebView），
 *    不支持时给出明确错误，不静默失败。
 *  - 安全: 只做文本抽取（DOMParser + textContent，脚本不执行）；
 *    zip 内路径规范化并拒绝 `..` 越界；文件大小上限 20MB 防内存失控。
 *  - 大文件分章: txt 按标题行（第X章/数字/漢数字/序/終章 等）切章；
 *    无标题时每 200 段切一部。epub 按 spine 每文档一章。
 *  - 存储: 内容入 IndexedDB（YomuStorage.saveBookContent），
 *    元数据入 settings.syncedBooks（阅读器已支持合并 → 书架可见、离线可读）。
 */
const YomuImporter = {
    MAX_BYTES: 20 * 1024 * 1024,

    async importFile(file) {
        if (!file) throw new Error('ファイルが選択されていません');
        if (file.size > this.MAX_BYTES) {
            throw new Error('ファイルが大きすぎます（上限 20MB）');
        }
        const name = file.name || '';
        const lower = name.toLowerCase();
        const buf = await file.arrayBuffer();

        let bookData;
        if (lower.endsWith('.epub')) {
            bookData = await this._parseEpub(buf, name);
        } else if (lower.endsWith('.txt') || lower.endsWith('.text')) {
            bookData = this._parseTxt(buf, name);
        } else {
            throw new Error('対応していない形式です（.txt / .epub のみ）');
        }

        if (!bookData.chapters || bookData.chapters.length === 0 ||
            !bookData.chapters.some(c => c.paragraphs && c.paragraphs.length > 0)) {
            throw new Error('本文が抽出できませんでした');
        }

        const id = 'local-' + Date.now().toString(36);
        const meta = {
            id,
            title: bookData.title || name.replace(/\.[^.]+$/, ''),
            author: bookData.author || '',
            desc: 'ローカルからインポート',
            source: 'local',
            available: true,
            addedAt: new Date().toISOString()
        };

        await YomuStorage.saveBookContent(id, { chapters: bookData.chapters });

        // 注册到 syncedBooks: reader.init 会把它并入书单（本会话手动并入）
        const settings = YomuStorage.getSettings();
        if (!Array.isArray(settings.syncedBooks)) settings.syncedBooks = [];
        settings.syncedBooks.push(meta);
        YomuStorage.set('settings', settings);
        if (window.YomuReader && Array.isArray(YomuReader._books) &&
            !YomuReader._books.find(b => b.id === id)) {
            YomuReader._books.push(meta);
        }
        return meta;
    },

    removeLocalBook(id) {
        const settings = YomuStorage.getSettings();
        if (Array.isArray(settings.syncedBooks)) {
            settings.syncedBooks = settings.syncedBooks.filter(b => b.id !== id);
            YomuStorage.set('settings', settings);
        }
        if (window.YomuReader && Array.isArray(YomuReader._books)) {
            YomuReader._books = YomuReader._books.filter(b => b.id !== id);
        }
        YomuStorage.deleteBookContent(id);
    },

    // ===== TXT =====

    _decode(buf) {
        // BOM
        if (buf.byteLength >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
            return new TextDecoder('utf-8').decode(buf.slice(3));
        }
        // 严格 UTF-8 优先，失败回落 Shift_JIS（日本語 txt 常见）
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch (e) {
            try {
                return new TextDecoder('shift_jis').decode(buf);
            } catch (e2) {
                return new TextDecoder('utf-8').decode(buf);
            }
        }
    },

    _txtParagraphs(text) {
        const paragraphs = [];
        let cur = '';
        for (const raw of text.split(/\r\n|\r|\n/)) {
            const line = raw.replace(/\u3000+$/g, '').trimEnd();
            if (!line.trim()) {
                if (cur.trim()) paragraphs.push(cur.trim());
                cur = '';
            } else {
                cur += (cur ? '' : '') + line.trim();
            }
        }
        if (cur.trim()) paragraphs.push(cur.trim());
        return paragraphs;
    },

    _CHAPTER_RE: /^\s*(?:第[0-9０-９一二三四五六七八九十百千]+[章話節回巻篇]|[0-9０-９]{1,3}|[一二三四五六七八九十]{1,3}|序章|序|終章|終|エピローグ|プロローグ|あとがき|後書き|まえがき)\s*[）)]?\s*$/,

    _parseTxt(buf, filename) {
        const text = this._decode(new Uint8Array(buf));
        const lines = text.split(/\r\n|\r|\n/);

        const chapters = [];
        let title = '';
        let curTitle = null;
        let paras = [];
        const flush = () => {
            const clean = paras.filter(p => p);
            if (curTitle !== null || clean.length > 0) {
                chapters.push({ title: curTitle || '本文', paragraphs: clean });
            }
            paras = [];
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // 最初の見出しらしき行を書名候補にしない（青空文庫は冒頭に書名行が来る）
            if (!title && i < 5 && line && line.length <= 40 && !this._CHAPTER_RE.test(line)) {
                // 先頭行は書名の可能性が高いが確定できないので拾わない
            }
            if (line && line.length <= 24 && this._CHAPTER_RE.test(line)) {
                flush();
                curTitle = line;
                continue;
            }
            if (!line) {
                if (paras.length && paras[paras.length - 1] !== '') paras.push('');
                continue;
            }
            paras.push(line);
        }
        flush();

        // 无标题 → 整本一章；超长时每 200 段一部，保持渲染/进度粒度
        const hasTitles = chapters.length > 1;
        if (!hasTitles) {
            const all = chapters.flatMap(c => c.paragraphs);
            if (all.length > 200) {
                const chunked = [];
                for (let i = 0; i < all.length; i += 200) {
                    chunked.push({ title: `第${chunked.length + 1}部`, paragraphs: all.slice(i, i + 200) });
                }
                chapters.length = 0;
                chapters.push(...chunked);
            } else {
                chapters.length = 0;
                chapters.push({ title: '本文', paragraphs: all });
            }
        }

        return {
            title: filename.replace(/\.[^.]+$/, ''),
            author: '',
            chapters
        };
    },

    // ===== EPUB (ZIP) =====

    async _zipEntries(buf) {
        const u8 = new Uint8Array(buf);
        const dv = new DataView(buf);
        // EOCD: 从尾部扫描
        let eocd = -1;
        const scanStart = Math.max(0, u8.length - 65557);
        for (let i = u8.length - 22; i >= scanStart; i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('EPUB が壊れています（ZIP 目録が見つかりません）');
        const count = dv.getUint16(eocd + 10, true);
        let ptr = dv.getUint32(eocd + 16, true);

        const entries = new Map();
        for (let n = 0; n < count; n++) {
            if (dv.getUint32(ptr, true) !== 0x02014b50) break;
            const flags = dv.getUint16(ptr + 8, true);
            const method = dv.getUint16(ptr + 10, true);
            const compSize = dv.getUint32(ptr + 20, true);
            const nameLen = dv.getUint16(ptr + 28, true);
            const extraLen = dv.getUint16(ptr + 30, true);
            const commentLen = dv.getUint16(ptr + 32, true);
            const localOff = dv.getUint32(ptr + 42, true);
            const name = new TextDecoder('utf-8').decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
            entries.set(name, { flags, method, compSize, localOff });
            ptr += 46 + nameLen + extraLen + commentLen;
        }
        return { u8, dv, entries };
    },

    async _zipRead(zip, name) {
        const e = zip.entries.get(name);
        if (!e) return null;
        if (e.flags & 0x1) throw new Error('暗号化された EPUB には対応していません');
        const dv = zip.dv;
        if (dv.getUint32(e.localOff, true) !== 0x04034b50) throw new Error('EPUB が壊れています');
        const nameLen = dv.getUint16(e.localOff + 26, true);
        const extraLen = dv.getUint16(e.localOff + 28, true);
        const start = e.localOff + 30 + nameLen + extraLen;
        const data = zip.u8.subarray(start, start + e.compSize);
        if (e.method === 0) return data;
        if (e.method === 8) {
            if (typeof DecompressionStream === 'undefined') {
                throw new Error('このブラウザは EPUB 解圧に対応していません（DecompressionStream 未対応）');
            }
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            const out = await new Response(stream).arrayBuffer();
            return new Uint8Array(out);
        }
        throw new Error('未知の圧縮方式です（method ' + e.method + '）');
    },

    _safePath(baseDir, href) {
        // 拒绝危险协议与越界路径
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
            throw new Error('EPUB 内に不正なリンクがあります: ' + href);
        }
        const combined = (baseDir ? baseDir + '/' : '') + href.split('#')[0];
        const parts = [];
        for (const seg of combined.split('/')) {
            if (!seg || seg === '.') continue;
            if (seg === '..') {
                if (parts.length === 0) throw new Error('EPUB 内パスが範囲外です');
                parts.pop();
                continue;
            }
            parts.push(seg);
        }
        return parts.join('/');
    },

    async _parseEpub(buf, filename) {
        const zip = await this._zipEntries(buf);

        const containerXml = await this._zipRead(zip, 'META-INF/container.xml');
        if (!containerXml) throw new Error('EPUB 構造が不正です（container.xml がありません）');
        const container = new DOMParser().parseFromString(new TextDecoder().decode(containerXml), 'text/xml');
        const rootfile = container.querySelector('rootfile');
        if (!rootfile) throw new Error('EPUB 構造が不正です（rootfile がありません）');
        const opfPath = rootfile.getAttribute('full-path');
        const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

        const opfRaw = await this._zipRead(zip, opfPath);
        if (!opfRaw) throw new Error('EPUB 構造が不正です（OPF が読めません）');
        const opf = new DOMParser().parseFromString(new TextDecoder().decode(opfRaw), 'text/xml');
        if (opf.querySelector('parsererror')) throw new Error('EPUB の OPF が解析できません');

        const title = (opf.getElementsByTagName('dc:title')[0] || {}).textContent || '';
        const author = (opf.getElementsByTagName('dc:creator')[0] || {}).textContent || '';

        const manifest = new Map();
        for (const item of opf.querySelectorAll('manifest > item')) {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href') || '';
            const type = item.getAttribute('media-type') || '';
            if (id) manifest.set(id, { href, type });
        }

        const chapters = [];
        for (const itemref of opf.querySelectorAll('spine > itemref')) {
            const idref = itemref.getAttribute('idref');
            const item = manifest.get(idref);
            if (!item) continue;
            if (!/xhtml|html/i.test(item.type)) continue;
            let path;
            try {
                path = this._safePath(baseDir, item.href);
            } catch (e) {
                throw e;
            }
            let raw;
            try {
                raw = await this._zipRead(zip, path);
            } catch (e) {
                console.warn('[Importer] skip spine item', path, e.message);
                continue;
            }
            if (!raw) continue;

            const doc = new DOMParser().parseFromString(new TextDecoder().decode(raw), 'text/html');
            // 文本抽取: 块级元素为段边界，脚本/样式丢弃（DOMParser 不执行脚本）
            const paras = [];
            const walker = doc.body ? doc.body : doc.documentElement;
            const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, div, pre';
            const blocks = walker.querySelectorAll(blockSelector);
            if (blocks.length > 0) {
                for (const b of blocks) {
                    // 嵌套 div: 只取叶子块，避免重复
                    if (b.querySelector(blockSelector)) continue;
                    const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
                    if (t) paras.push(t);
                }
            } else {
                const t = (walker.textContent || '').trim();
                if (t) paras.push(t);
            }
            if (paras.length === 0) continue;

            let chTitle = '';
            const h = doc.querySelector('h1, h2, h3');
            if (h) chTitle = (h.textContent || '').replace(/\s+/g, ' ').trim();
            chapters.push({ title: chTitle || `第${chapters.length + 1}章`, paragraphs: paras });
        }

        if (chapters.length === 0) throw new Error('EPUB から本文が抽出できませんでした');
        return {
            title: title.trim() || filename.replace(/\.epub$/i, ''),
            author: author.trim(),
            chapters
        };
    }
};

window.YomuImporter = YomuImporter;
