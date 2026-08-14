/**
 * Yomu 自绘交互组件 — 替代系统原生控件
 *
 * 规约：本项目禁止系统原生 alert/confirm/prompt/select 下拉。
 * 全部组件自绘，跟随主题 CSS 变量（--bg/--fg/--accent/--hairline…）。
 *
 *  - YomuPop.select(opts)   : 自绘下拉选择器（附着在触发按钮下方，底部弹层兜底）
 *  - YomuPop.prompt(opts)   : 自绘文本输入弹窗（替代 window.prompt）
 *  - YomuPop.alert / confirm: 复用 index.html 既有 modal（保持 API 兼容）
 *
 * 依赖：无（vanilla），在 app.js 之前加载。
 */
(function () {
    'use strict';

    const YomuPop = {};

    /* ---------------------------------------------------------------
       工具
    --------------------------------------------------------------- */
    function ensureContainer() {
        let c = document.getElementById('ypop-root');
        if (!c) {
            c = document.createElement('div');
            c.id = 'ypop-root';
            document.body.appendChild(c);
        }
        return c;
    }

    function closeAllPopovers(except) {
        document.querySelectorAll('.ypop-menu').forEach(m => {
            if (m !== except) m.remove();
        });
        document.querySelectorAll('.ypop-trigger.open').forEach(t => {
            if (t !== except) t.classList.remove('open');
        });
    }

    // 唯一实例：一次只允许一个打开
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.ypop-menu') && !e.target.closest('.ypop-trigger')) {
            closeAllPopovers();
        }
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const menu = document.querySelector('.ypop-menu');
            if (menu) {
                const sel = menu._yomuPopState;
                closeAllPopovers();
                if (sel && sel.onClose) sel.onClose();
            }
        }
    });
    window.addEventListener('resize', () => closeAllPopovers());
    window.addEventListener('scroll', () => closeAllPopovers(), true);

    /* ---------------------------------------------------------------
       自绘下拉选择器
       select({ trigger, options, value, onChange, align })
         trigger : 触发按钮元素（必须已存在于 DOM）
         options : [{ value, label, disabled?, hint? }]
         value   : 当前值
         onChange(value, option)
         align   : 'left' | 'right'（菜单与触发器对齐方式，默认 left）
    --------------------------------------------------------------- */
    YomuPop.select = function (opts) {
        const { trigger, options, value, onChange, align = 'left' } = opts;
        if (!trigger || !Array.isArray(options)) return;

        const renderLabel = (o) => (o && o.label) || '';

        // ---- 触发按钮（自绘，替代 <select>）----
        let btn = trigger.querySelector('.ypop-trigger');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ypop-trigger';
            trigger.appendChild(btn);
        }
        // 保留原 select 的类名（如 settings-select-inline 的布局约束），跳过宿主标识类
        if (trigger.className) {
            btn.classList.add(...trigger.className.split(/\s+/).filter(Boolean).filter(c => c !== 'ypop-host'));
        }
        const cur = options.find(o => o.value === value);
        btn.innerHTML =
            '<span class="ypop-trigger-value">' + esc(renderLabel(cur)) + '</span>' +
            '<svg class="ypop-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');

        // 状态同步入口（替代 select.value = x）
        trigger.setValue = (v) => {
            const o = options.find(o => o.value === v);
            btn.querySelector('.ypop-trigger-value').textContent = renderLabel(o);
            trigger._ypValue = v;
        };
        trigger.setValue(value);
        trigger._ypOptions = options;
        trigger._ypOnChange = onChange;

        if (!btn._ypBound) {
            btn._ypBound = true;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.classList.contains('open')) {
                    closeAllPopovers();
                    return;
                }
                openMenu(trigger, btn, options, align);
            });
        }
    };

    function openMenu(trigger, btn, options, align) {
        closeAllPopovers();
        const state = trigger._ypOnChange ? trigger : null;

        const menu = document.createElement('div');
        menu.className = 'ypop-menu';
        menu.setAttribute('role', 'listbox');

        options.forEach(o => {
            const item = document.createElement('div');
            item.className = 'ypop-item' + (o.value === trigger._ypValue ? ' selected' : '') + (o.disabled ? ' disabled' : '');
            item.setAttribute('role', 'option');
            item.innerHTML =
                '<span class="ypop-item-label">' + esc(o.label) + '</span>' +
                (o.hint ? '<span class="ypop-item-hint">' + esc(o.hint) + '</span>' : '') +
                '<svg class="ypop-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
            if (!o.disabled) {
                item.addEventListener('click', () => {
                    trigger._ypValue = o.value;
                    trigger.setValue(o.value);
                    closeAllPopovers();
                    if (trigger._ypOnChange) trigger._ypOnChange(o.value, o);
                });
            }
            menu.appendChild(item);
        });

        // 定位：优先附着在触发器下方；视口放不下则向上翻；极小屏/空间不足走底部弹层
        const r = btn.getBoundingClientRect();
        const estH = Math.min(options.length, 7) * 44 + 12;
        const spaceBelow = window.innerHeight - r.bottom;
        const spaceAbove = r.top;

        if (window.innerWidth < 480 || (spaceBelow < estH && spaceAbove < estH)) {
            // 底部弹层（移动端样式，与 action-sheet 同族）
            menu.classList.add('ypop-sheet');
            ensureContainer().appendChild(menu);
            requestAnimationFrame(() => menu.classList.add('open'));
        } else {
            menu.style.position = 'fixed';
            menu.style.minWidth = Math.max(r.width, 180) + 'px';
            document.body.appendChild(menu);
            const mr = menu.getBoundingClientRect();
            let top = r.bottom + 6;
            if (top + mr.height > window.innerHeight - 8 && spaceAbove > spaceBelow) {
                top = Math.max(8, r.top - mr.height - 6);
                menu.classList.add('above');
            }
            let left = align === 'right' ? r.right - mr.width : r.left;
            left = Math.min(Math.max(8, left), window.innerWidth - mr.width - 8);
            menu.style.top = top + 'px';
            menu.style.left = left + 'px';
            requestAnimationFrame(() => menu.classList.add('open'));
        }

        btn.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        menu._yomuPopState = { onClose: null };
        const mo = new MutationObserver(() => {
            if (!document.contains(menu)) {
                btn.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
                mo.disconnect();
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
        void state;
    }

    /* ---------------------------------------------------------------
       自绘文本输入弹窗（替代 window.prompt）
       prompt({ title, label, value, maxlength, placeholder, onOk })
         返回 Promise<string|null>；也可用 onOk 回调
    --------------------------------------------------------------- */
    YomuPop.prompt = function (opts) {
        const { title = '', label = '', value = '', maxlength = 2000, placeholder = '', onOk } = opts || {};
        return new Promise(resolve => {
            closeAllPopovers();

            const overlay = document.createElement('div');
            overlay.className = 'ypop-prompt-overlay';
            overlay.innerHTML =
                '<div class="ypop-prompt-card" role="dialog" aria-modal="true">' +
                (title ? '<h2 class="ypop-prompt-title">' + esc(title) + '</h2>' : '') +
                (label ? '<p class="ypop-prompt-label">' + esc(label) + '</p>' : '') +
                '<textarea class="ypop-prompt-input" rows="4" maxlength="' + maxlength + '" placeholder="' + esc(placeholder) + '"></textarea>' +
                '<div class="ypop-prompt-footer">' +
                '<button type="button" class="ypop-btn cancel">キャンセル</button>' +
                '<button type="button" class="ypop-btn primary">保存</button>' +
                '</div></div>';

            const input = overlay.querySelector('.ypop-prompt-input');
            input.value = value;

            const close = (result) => {
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 180);
                if (onOk && result !== null) onOk(result);
                resolve(result);
            };

            overlay.querySelector('.ypop-btn.cancel').addEventListener('click', () => close(null));
            overlay.querySelector('.ypop-btn.primary').addEventListener('click', () => close(input.value.slice(0, maxlength)));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') close(null);
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) close(input.value.slice(0, maxlength));
            });

            document.body.appendChild(overlay);
            requestAnimationFrame(() => {
                overlay.classList.add('active');
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            });
        });
    };

    /* ---------------------------------------------------------------
       esc
    --------------------------------------------------------------- */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    window.YomuPop = YomuPop;
})();
