/**
 * Yomu shared book-cover renderer.
 *
 * The test page and the library must use exactly the same cover geometry.
 * Keep progress-to-cover-state logic here; page-specific code only supplies
 * the book data and escape functions.
 */
const YomuBookCover = (() => {
    const AUTHOR_THEMES = {
        '夏目漱石': 'souseki',
        '芥川龍之介': 'akutagawa',
        '太宰治': 'dazai',
        '宮沢賢治': 'kenji',
        '森鴎外': 'ogai',
        '森鷗外': 'ogai',
        '中島敦': 'nakajima',
        '泉鏡花': 'kyoka',
        '泉鏡花、泉鏡太郎': 'kyoka',
        '江戸川乱歩': 'ranpo',
        '坂口安吾': 'ango',
        '島崎藤村': 'toson',
        '谷崎潤一郎': 'tanizaki',
        '国木田独歩': 'doppo',
        '樋口一葉': 'ichiyo'
    };

    const escape = (value, fn) => (fn ? fn(String(value || '')) : String(value || ''));

    function publisherOf(book) {
        return book.publisher || (book.baseBook || '').split(/[、,，]/).pop().trim() || '青空文庫';
    }

    function backContent(book, percent, escapeHtml) {
        const isFinished = percent === 100;
        const stamp = isFinished ? '<span class="stamp-done">読了</span>' : '';
        const workNum = (book.workId || book.id || 'BOOK').toString().replace(/\D/g, '').slice(0, 5) || '001';
        const barcode = `
            <div class="barcode-wrap">
                <div class="barcode-lines"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
                <span class="barcode-num">978-AOZORA-${workNum}</span>
            </div>
        `;

        if (book.desc && book.desc.trim()) {
            let text = book.desc.replace(/[。！!]+$/, '').trim();
            const quote = text.match(/「([^」]+)」/);
            if (quote) text = quote[1];
            if (text.length > 6) {
                const mid = Math.min(6, Math.ceil(text.length / 2));
                text = `${text.slice(0, mid)}<br>${text.slice(mid, mid + 6)}`;
            }
            return `<div class="back-inner">
                <div class="back-header"><span>${escapeHtml(book.ndc || 'NDC 913')}</span><span>青空文庫</span></div>
                <div class="vertical-quote-wrap"><div class="vertical-quote">${text}</div></div>
                <div class="back-footer">${barcode}${stamp}</div>
            </div>`;
        }

        return `<div class="back-inner">
            <div class="back-header"><span>${escapeHtml(book.ndc || 'NDC 913')}</span><span>青空文庫</span></div>
            <div class="center-crest">
                <div class="crest-svg">
                    <svg width="28" height="28" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.4">
                        <circle cx="18" cy="18" r="16" stroke-dasharray="3 2"/>
                        <path d="M10 20c3-3 6-5 8-5s5 2 8 5c-3-1-5-1-8 1-3-2-5-2-8-1z" fill="currentColor" fill-opacity="0.18"/>
                        <circle cx="18" cy="12" r="1.8" fill="currentColor"/>
                    </svg>
                </div>
                <div class="crest-text">青空文庫</div>
                <div class="crest-sub">日本文学・名作選</div>
            </div>
            <div class="back-footer">${barcode}${stamp}</div>
        </div>`;
    }

    function render(book, percent, options = {}) {
        const escapeHtml = options.escapeHtml || ((value) => value);
        const escapeAttr = options.escapeAttr || escapeHtml;
        const clamped = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        const isUndownloaded = Boolean(options.isUndownloaded);
        const threshold = 75;
        const isFlipped = clamped > threshold && !isUndownloaded;

        const mode = options.mode || 'subtle'; // 正式使用方案 2：弱透视克制微张（最大开角 28°，远透视 2400px，高度形变小于 2px）
        let frontAngle = 0;
        let frontOpacity = 1;
        let backAngle = 0;
        let backShift = 0;
        let coverScale = 1;
        let frontScaleX = 1;
        let backScaleX = 1;
        let pageScaleXs = [1, 1, 1, 1];
        let pageAngles = [0, 0, 0, 0];

        if (clamped > 0 && !isUndownloaded) {
            const ratio = clamped <= threshold ? clamped / threshold : 0;
            const remain = clamped > threshold ? (100 - clamped) / (100 - threshold) : 0;

            if (mode === 'ortho') {
                // 方案 3：和风平视正交收折（上下绝对 100% 水平平齐，仅水平收窄与内页层叠，高度恒定 220px）
                frontAngle = 0;
                backAngle = 0;
                if (!isFlipped) {
                    const shrinkDelta = 0.48 * Math.pow(ratio, 0.85);
                    frontScaleX = 1 - shrinkDelta;
                    frontOpacity = Math.max(0.6, 1 - 0.4 * ratio);
                    pageScaleXs = [0.15, 0.30, 0.45, 0.65].map(step => 1 - shrinkDelta * step);
                } else {
                    const shrinkDelta = 0.48 * Math.pow(remain, 0.9);
                    backScaleX = 1 - shrinkDelta;
                    pageScaleXs = [0.15, 0.30, 0.45, 0.65].map(step => 1 - shrinkDelta * step);
                }
            } else if (mode === 'subtle') {
                // 方案 2：弱透视克制角度（最大开角 28°，远透视 2400px，文气质感微张，高度起伏小于 2px）
                if (!isFlipped) {
                    frontAngle = -28 * Math.pow(ratio, 0.85);
                    frontOpacity = Math.max(0.4, 1 - 0.5 * ratio);
                } else {
                    backAngle = 28 * Math.pow(remain, 0.9);
                }
                pageAngles = [0.25, 0.50, 0.75, 1.00].map(r => (isFlipped ? backAngle : frontAngle) * r);
            } else if (mode === 'scale') {
                // 方案 1：等高 3D 整体收缩（保持 65° 大角度，但通过整体 scale 缩小，使 3D 展开后的上下顶点贴合 220px）
                if (!isFlipped) {
                    frontAngle = -65 * Math.pow(ratio, 0.85);
                    frontOpacity = Math.max(0.4, 1 - 0.5 * ratio);
                    coverScale = 1 / (1 + 0.33 * Math.pow(ratio, 0.85));
                } else {
                    backAngle = 65 * Math.pow(remain, 0.9);
                    coverScale = 1 / (1 + 0.33 * Math.pow(remain, 0.9));
                }
                pageAngles = [0.2, 0.4, 0.6, 0.8].map(r => (isFlipped ? backAngle : frontAngle) * r);
            } else {
                // 方案 0：现状对照（未做高度收缩的大角度 3D）
                if (!isFlipped) {
                    frontAngle = -65 * Math.pow(ratio, 0.85);
                    frontOpacity = Math.max(0.4, 1 - 0.5 * ratio);
                } else {
                    backAngle = 65 * Math.pow(remain, 0.9);
                }
                pageAngles = [0.2, 0.4, 0.6, 0.8].map(r => (isFlipped ? backAngle : frontAngle) * r);
            }
        }

        const theme = AUTHOR_THEMES[book.author || ''] || 'default';
        const category = options.category || book.category || 'default';
        const categoryClass = ` cat-${category}`;
        const extraClass = options.extraClass ? ` ${options.extraClass}` : '';
        const modeClass = ` mode-${mode}`;
        const stateClass = `${clamped === 0 || isUndownloaded ? ' is-closed' : ''}${clamped === 100 ? ' is-finished' : ''}${isFlipped ? ' is-flipped' : ''}${isUndownloaded ? ' is-undownloaded' : ''}`;
        const coverNdc = book.ndc || 'NDC 913';
        const author = book.author || '';
        const publisher = publisherOf(book);
        const translationMark = book.hasTrans
            ? '<span class="book-cover-translation-mark" title="翻訳あり" aria-label="翻訳あり">訳</span>'
            : '';
        const front = isUndownloaded ? `
            <span class="book-cover-mark" aria-hidden="true">${escape(coverNdc, escapeHtml)}</span>
            ${translationMark}
            <span class="book-cover-title">${escape(book.title, escapeHtml)}</span>
            <span class="book-cover-author">${escape(author, escapeHtml)}</span>
            <span class="book-cover-rule" aria-hidden="true"></span>
            <span class="book-cover-publisher">${escape(publisher, escapeHtml)}</span>
            <div class="book-cover-download-icon" title="クリックして保存">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle class="download-disc" cx="12" cy="12" r="10"/>
                    <polyline class="download-arrow" points="8.5 11.5 12 15 15.5 11.5"/>
                    <line class="download-arrow" x1="12" y1="7.5" x2="12" y2="15"/>
                </svg>
            </div>
        ` : `
            <span class="book-cover-mark" aria-hidden="true">${escape(coverNdc, escapeHtml)}</span>
            ${translationMark}
            <span class="book-cover-title">${escape(book.title, escapeHtml)}</span>
            <span class="book-cover-author">${escape(author, escapeHtml)}</span>
            <span class="book-cover-rule" aria-hidden="true"></span>
            <span class="book-cover-publisher">${escape(publisher, escapeHtml)}</span>
        `;

        const style = [
            `--front-angle:${frontAngle.toFixed(1)}`,
            `--front-opacity:${frontOpacity}`,
            `--cover-scale:${coverScale.toFixed(3)}`,
            `--front-scale-x:${frontScaleX.toFixed(3)}`,
            `--back-scale-x:${backScaleX.toFixed(3)}`,
            `--back-angle:${backAngle.toFixed(1)}`,
            `--back-shift:${backShift.toFixed(1)}`,
            ...pageAngles.flatMap((angle, i) => [`--page${i + 1}-angle:${angle.toFixed(1)}`, `--page${i + 1}-shift:0`]),
            ...pageScaleXs.map((sx, i) => `--page${i + 1}-scale-x:${sx.toFixed(3)}`)
        ].join(';');
        const back = isFlipped ? backContent(book, clamped, escapeHtml) : '';

        return `<div class="book-cover book-cover-${theme}${categoryClass}${modeClass}${extraClass}${stateClass}" data-progress="${clamped}" style="${style}" aria-label="${escape(book.title, escapeAttr)} — ${escape(author, escapeAttr)}">
            <div class="book-cover-pages-base" aria-hidden="true"><div class="book-cover-page-lines"></div></div>
            <div class="book-cover-page-turning page-layer-1" aria-hidden="true"></div>
            <div class="book-cover-page-turning page-layer-2" aria-hidden="true"></div>
            <div class="book-cover-page-turning page-layer-3" aria-hidden="true"></div>
            <div class="book-cover-page-turning page-layer-4" aria-hidden="true"></div>
            <div class="book-cover-back" aria-hidden="true">${back}</div>
            <div class="book-cover-front">${front}</div>
            <i class="book-cover-spine" aria-hidden="true"></i>
        </div>`;
    }

    const instance = { render };
    if (typeof window !== 'undefined') window.YomuBookCover = instance;
    if (typeof globalThis !== 'undefined') globalThis.YomuBookCover = instance;
    return instance;
})();
