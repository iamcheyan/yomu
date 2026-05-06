import sys

with open('js/app.js', 'rb') as f:
    content = f.read()

# Lines are 1-indexed. We want to keep 1-1053 and 1230-end.
lines = content.splitlines(keepends=True)
header = lines[:1053]
footer = lines[1229:]

new_middle = """
    _updateNlpOptionState() {
        const furiSelect = document.getElementById('furigana-mode-select');
        const dictStatus = document.getElementById('dict-status-msg');
        const dlBtn = document.getElementById('btn-dict-dl');
        if (!furiSelect) return;

        const nlpOption = furiSelect.querySelector('option[value="nlp"]');
        const dictReady = YomuTokenizer.isDictAvailable();

        if (nlpOption) {
            nlpOption.disabled = !dictReady;
            // Hide the option if not ready to keep UI clean
            nlpOption.style.display = dictReady ? '' : 'none';
        }

        if (dictStatus) {
            dictStatus.textContent = dictReady ? 'ダウンロード済み' : '未ダウンロード';
        }

        const dlGroup = document.getElementById('dict-download-group');
        if (dlGroup) {
            // If bundled or already downloaded, we can hide the whole download section to simplify UI
            dlGroup.style.display = dictReady ? 'none' : '';
        }

        if (dlBtn) {
            dlBtn.disabled = dictReady;
            dlBtn.textContent = dictReady ? '完了' : 'ダウンロード';
        }

        if (!dictReady) {
            // Auto-downgrade if currently set to nlp
            const settings = YomuStorage.getSettings();
            if (settings.furiganaMode === 'nlp') {
                YomuStorage.saveSetting('furiganaMode', 'internal');
                furiSelect.value = 'internal';
                this._applySettings();
            }
        }
    },

    async promptDictDownload(isAuto = false) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('modal-overlay');
            const titleEl = document.getElementById('modal-title');
            const msgEl = document.getElementById('modal-message');
            const okBtn = document.getElementById('modal-ok-btn');
            const cancelBtn = document.getElementById('modal-cancel-btn');

            titleEl.textContent = '辞書ダウンロード';
            
            if (isAuto) {
                msgEl.innerHTML = `
                    <p>形態素解析エンジン「Kuromoji」の辞書データが未ダウンロードです。</p>
                    <p style="text-align:left; font-size:13px; line-height:1.6; margin-top:10px; color:#444;">
                        このデータをダウンロードすることで、アプリ内のすべての単語に正確なふりがなを表示し、分词（ワードラップ）の精度を向上させることができます。
                    </p>
                    <p class="dict-progress-info">約18MB / Wi-Fi環境推奨</p>
                    <span class="download-status-text" id="dict-dl-status"></span>
                    <div class="download-progress-container hidden" id="dict-dl-progress-wrap">
                        <div class="download-progress-fill" id="dict-dl-progress" style="--progress-width:0%"></div>
                    </div>
                `;
            } else {
                msgEl.innerHTML = `
                    <p>ふりがな表示に必要な Kuromoji 辞書をダウンロードしますか？</p>
                    <p class="dict-progress-info">約18MB / Wi-Fi推奨</p>
                    <span class="download-status-text" id="dict-dl-status"></span>
                    <div class="download-progress-container hidden" id="dict-dl-progress-wrap">
                        <div class="download-progress-fill" id="dict-dl-progress" style="--progress-width:0%"></div>
                    </div>
                `;
            }
            
            okBtn.textContent = 'ダウンロード';
            okBtn.classList.remove('hidden');
            cancelBtn.textContent = isAuto ? '後で' : 'キャンセル';
            cancelBtn.classList.remove('hidden');
            overlay.classList.add('active');

            const cleanup = () => {
                overlay.classList.remove('active');
                okBtn.textContent = 'OK';
                cancelBtn.textContent = 'キャンセル';
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve();
            };

            okBtn.onclick = () => {
                okBtn.classList.add('hidden');
                cancelBtn.classList.add('hidden');

                const statusEl = document.getElementById('dict-dl-status');
                const progressWrap = document.getElementById('dict-dl-progress-wrap');
                const progressEl = document.getElementById('dict-dl-progress');
                if (progressWrap) progressWrap.classList.remove('hidden');
                if (statusEl) statusEl.textContent = 'ダウンロード中...';

                YomuTokenizer.downloadDict(
                    (overallProgress, filename, fileProgress) => {
                        if (statusEl) statusEl.textContent = `ダウンロード中... (${overallProgress}%)`;
                        if (progressEl) progressEl.style.setProperty('--progress-width', overallProgress + '%');
                    },
                    async (successCount, totalCount) => {
                        if (successCount === totalCount) {
                            if (statusEl) statusEl.textContent = '辞書を読み込み中...';
                            await YomuTokenizer.reinit();
                            
                            // Auto-switch to NLP mode
                            YomuStorage.saveSetting('furiganaMode', 'nlp');
                            this._applySettings();
                            
                            this._updateNlpOptionState();
                            
                            if (statusEl) statusEl.textContent = '完了しました！';
                            okBtn.textContent = '閉じる';
                            okBtn.classList.remove('hidden');
                            okBtn.onclick = () => { cleanup(); resolve(); };
                        } else {
                            if (statusEl) statusEl.textContent = `一部のファイルのダウンロードに失敗しました (${successCount}/${totalCount})`;
                            okBtn.textContent = '再試行';
                            okBtn.classList.remove('hidden');
                            cancelBtn.textContent = '閉じる';
                            cancelBtn.classList.remove('hidden');
                            cancelBtn.onclick = () => { cleanup(); resolve(); };
                        }
                    },
                    (filename, error) => {
                        console.error(`Download error for ${filename}: ${error}`);
                    }
                );
            };
        });
    },

    async clearAllData() {
        const overlay = document.getElementById('modal-overlay');
        const titleEl = document.getElementById('modal-title');
        const msgEl = document.getElementById('modal-message');
        const okBtn = document.getElementById('modal-ok-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');

        titleEl.textContent = 'データの全削除';
        msgEl.innerHTML = 'すべての設定、読書履歴、ダウンロードした本、および辞書データを削除しますか？<br><br><span class="u-color-error">※この操作は取り消せません。</span>';
        
        okBtn.textContent = '削除する';
        okBtn.classList.remove('hidden');
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.classList.remove('hidden');
        overlay.classList.add('active');

        okBtn.onclick = async () => {
            okBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            msgEl.textContent = '削除中...';
            
            try {
                await YomuStorage.clearAllData();
                msgEl.textContent = '削除完了。アプリを再起動します。';
                setTimeout(() => {
                    window.location.hash = '';
                    window.location.reload();
                }, 1500);
            } catch (e) {
                console.error('Clear failed:', e);
                msgEl.textContent = '削除に失败しました。';
                cancelBtn.classList.remove('hidden');
                cancelBtn.textContent = '閉じる';
                cancelBtn.onclick = () => overlay.classList.remove('active');
            }
        };

        cancelBtn.onclick = () => {
            overlay.classList.remove('active');
        };
    },
""".encode('utf-8')

with open('js/app.js', 'wb') as f:
    f.writelines(header)
    f.write(new_middle)
    f.writelines(footer)
