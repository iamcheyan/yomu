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

        let frontAngle = 0;
        let frontOpacity = 1;
        let backAngle = 0;
        let backShift = 0;
        if (clamped > 0 && !isUndownloaded && !isFlipped) {
            const ratio = clamped / threshold;
            frontAngle = -65 * Math.pow(ratio, 0.85);
            frontOpacity = Math.max(0.4, 1 - 0.5 * ratio);
        } else if (isFlipped) {
            const remain = (100 - clamped) / (100 - threshold);
            backAngle = 65 * Math.pow(remain, 0.9);
        }

        const pageAngles = [0.2, 0.4, 0.6, 0.8].map(ratio =>
            (isFlipped ? backAngle : frontAngle) * ratio
        );
        const theme = AUTHOR_THEMES[book.author || ''] || 'default';
        const categoryClass = options.category ? ` cat-${options.category}` : '';
        const extraClass = options.extraClass ? ` ${options.extraClass}` : '';
        const stateClass = `${clamped === 0 || isUndownloaded ? ' is-closed' : ''}${clamped === 100 ? ' is-finished' : ''}${isFlipped ? ' is-flipped' : ''}${isUndownloaded ? ' is-undownloaded' : ''}`;
        const coverNdc = book.ndc || 'NDC 913';
        const author = book.author || '';
        const publisher = publisherOf(book);
        const front = isUndownloaded ? `
            <span class="book-cover-mark" aria-hidden="true">${escape(coverNdc, escapeHtml)}</span>
            <span class="book-cover-title">${escape(book.title, escapeHtml)}</span>
            <span class="book-cover-author">${escape(author, escapeHtml)}</span>
            <span class="book-cover-rule" aria-hidden="true"></span>
            <span class="book-cover-publisher">${escape(publisher, escapeHtml)}</span>
            <div class="book-cover-cloud-icon" title="クリックして保存">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
                    <polyline points="9 13 12 16 15 13"/><line x1="12" y1="9" x2="12" y2="16"/>
                </svg>
            </div>
        ` : `
            <span class="book-cover-mark" aria-hidden="true">${escape(coverNdc, escapeHtml)}</span>
            <span class="book-cover-title">${escape(book.title, escapeHtml)}</span>
            <span class="book-cover-author">${escape(author, escapeHtml)}</span>
            <span class="book-cover-rule" aria-hidden="true"></span>
            <span class="book-cover-publisher">${escape(publisher, escapeHtml)}</span>
        `;

        const style = [
            `--front-angle:${frontAngle.toFixed(1)}`,
            `--front-opacity:${frontOpacity}`,
            `--back-angle:${backAngle.toFixed(1)}`,
            `--back-shift:${backShift.toFixed(1)}`,
            ...pageAngles.flatMap((angle, i) => [`--page${i + 1}-angle:${angle.toFixed(1)}`, `--page${i + 1}-shift:0`])
        ].join(';');
        const back = isFlipped ? backContent(book, clamped, escapeHtml) : '';

        return `<div class="book-cover book-cover-${theme}${categoryClass}${extraClass}${stateClass}" data-progress="${clamped}" style="${style}" aria-label="${escape(book.title, escapeAttr)} — ${escape(author, escapeAttr)}">
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

    return { render };
})();
