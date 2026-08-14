/**
 * Yomu Stats — 阅读统计 (B3)
 *
 * 隐私: 全部数据仅在本地（YomuStorage key 'reading_stats'），无任何上报。
 *
 * 口径:
 *  - 分钟: 阅读器打开且页面可见时每 30s 累计 0.5 分钟。
 *  - 字数: 单书进度百分比创新高时，累加 全文字数 × Δ%（跨刷新/跨书正确：
 *    每本书的历史最高进度持久化，倒退重读不重复计数）。
 *  - 连续天数: 从今天往回数连续有记录的天数（今天尚无记录时从昨天起算）。
 *  - 目标: 每日阅读分钟目标，默认 15，可在设置中调整。
 */
const YomuStats = {
    _timer: null,
    _reading: false,

    _data() {
        return YomuStorage.get('reading_stats', { days: {}, bookMax: {}, goalMinutes: 15 });
    },

    _save(data) {
        YomuStorage.set('reading_stats', data);
    },

    _today() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    init() {
        document.addEventListener('visibilitychange', () => this._syncVisibility());
        this.setReading(this._reading);
    },

    /**
     * app.js 在进入/离开阅读器时调用。可见且阅读中时启动心跳计时。
     */
    setReading(active) {
        this._reading = Boolean(active);
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        if (this._reading) {
            // 30s 心跳: 仅在页面可见时累计
            this._timer = setInterval(() => {
                if (document.visibilityState === 'visible') {
                    this._addMinutes(0.5);
                }
            }, 30000);
        }
        this._syncVisibility();
    },

    _syncVisibility() {
        if (typeof window.Yomu === 'undefined' || !Yomu._isReaderOpen) return;
        if (document.visibilityState !== 'visible') return;
        // nothing extra: heartbeat handles accumulation
    },

    _day(data, dateStr) {
        if (!data.days[dateStr]) data.days[dateStr] = { minutes: 0, chars: 0 };
        return data.days[dateStr];
    },

    _addMinutes(mins) {
        const data = this._data();
        const day = this._day(data, this._today());
        day.minutes = Math.round((day.minutes + mins) * 10) / 10;
        this._save(data);
        this._renderUI();
    },

    /**
     * 当前书的字数（懒计算，来自 reader 的段落表）。
     */
    _currentBookCharCount() {
        if (typeof YomuReader === 'undefined' || !YomuReader._paragraphs) return 0;
        let n = 0;
        for (const p of YomuReader._paragraphs) {
            n += (p.content || '').length;
        }
        return n;
    },

    /**
     * reader 进度保存时调用（bookId, percent）。新高时累计字数。
     */
    onProgress(bookId, percent) {
        if (!bookId || !(percent > 0)) return;
        const data = this._data();
        const prevMax = data.bookMax[bookId] || 0;
        if (percent <= prevMax) return;
        const total = this._currentBookCharCount();
        if (total > 0) {
            const delta = Math.round(total * (percent - prevMax) / 100);
            if (delta > 0) {
                const day = this._day(data, this._today());
                day.chars += delta;
            }
        }
        data.bookMax[bookId] = percent;
        this._save(data);
        this._renderUI();
    },

    /**
     * 连续阅读天数: 今天有记录则从今天起算，否则从昨天起算。
     */
    streak() {
        const data = this._data();
        let days = 0;
        const cursor = new Date();
        if (!data.days[this._today()]) cursor.setDate(cursor.getDate() - 1);
        for (;;) {
            const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
            const d = data.days[key];
            if (d && (d.minutes > 0 || d.chars > 0)) {
                days++;
                cursor.setDate(cursor.getDate() - 1);
            } else {
                break;
            }
        }
        return days;
    },

    totals() {
        const data = this._data();
        let minutes = 0, chars = 0, activeDays = 0;
        for (const k of Object.keys(data.days)) {
            minutes += data.days[k].minutes;
            chars += data.days[k].chars;
            activeDays++;
        }
        return { minutes: Math.round(minutes), chars, activeDays };
    },

    goalMinutes() {
        return this._data().goalMinutes || 15;
    },

    setGoalMinutes(m) {
        const data = this._data();
        data.goalMinutes = Math.max(5, Math.min(480, parseInt(m) || 15));
        this._save(data);
        this._renderUI();
    },

    // ===== 设置面板 UI =====
    _renderUI() {
        const wrap = document.getElementById('reading-stats');
        if (!wrap) return;
        const data = this._data();
        const today = data.days[this._today()] || { minutes: 0, chars: 0 };
        const goal = data.goalMinutes || 15;
        const pct = Math.min(100, Math.round(today.minutes / goal * 100));
        const t = this.totals();

        wrap.innerHTML = `
            <div class="stats-row">
                <span>今日 <strong>${today.minutes}</strong> 分 / ${today.chars} 字</span>
                <span>連続 <strong>${this.streak()}</strong> 日</span>
            </div>
            <div class="stats-goal-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemax="100">
                <div class="stats-goal-fill" style="width:${pct}%"></div>
            </div>
            <div class="stats-row stats-row-sub">
                <span>累計 ${t.minutes} 分 · ${t.chars.toLocaleString()} 字</span>
                <span class="stats-goal-select">
                    目標
                    <span class="stats-goal-host"></span>
                </span>
            </div>
        `;

        // 自绘目标时长下拉（替代原生 select）
        const goalHost = wrap.querySelector('.stats-goal-host');
        if (goalHost && window.YomuPop) {
            YomuPop.select({
                trigger: goalHost,
                options: [5, 15, 30, 60, 120].map(m => ({ value: m, label: `${m} 分/日` })),
                value: goal,
                onChange: (v) => YomuStats.setGoalMinutes(v)
            });
        }
    }
};

window.YomuStats = YomuStats;
