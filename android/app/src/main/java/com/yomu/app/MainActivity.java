package com.yomu.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.File;

public class MainActivity extends Activity {
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏模式（适合墨水平板）
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // 关键：允许跨域读取本地存储的 JSON 词库
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        // 禁用缩放（墨水平板不需要）
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);

        // 禁用过度滚动效果（墨水屏优化）
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // 自动注入数据根路径
                view.evaluateJavascript("window.DATA_ROOT = 'file:///sdcard/Yomu/data';", null);
                view.evaluateJavascript("window.IS_ANDROID = true;", null);
            }
        });

        // 注册原生桥接，允许 JS 读写文件
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void saveFile(String filename, String content) {
                try {
                    File dir = new File("/sdcard/Yomu/data");
                    if (!dir.exists()) dir.mkdirs();
                    File file = new File(dir, filename);
                    java.io.FileWriter writer = new java.io.FileWriter(file);
                    writer.write(content);
                    writer.close();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }

            @android.webkit.JavascriptInterface
            public String readFile(String filename) {
                try {
                    File file = new File("/sdcard/Yomu/data", filename);
                    if (!file.exists()) return null;
                    java.util.Scanner scanner = new java.util.Scanner(file).useDelimiter("\\A");
                    return scanner.hasNext() ? scanner.next() : "";
                } catch (Exception e) {
                    return null;
                }
            }

            @android.webkit.JavascriptInterface
            public String listFiles() {
                try {
                    File dir = new File("/sdcard/Yomu/data");
                    if (!dir.exists()) return "[]";
                    File[] files = dir.listFiles();
                    if (files == null) return "[]";
                    StringBuilder sb = new StringBuilder("[");
                    for (int i = 0; i < files.length; i++) {
                        sb.append("\"").append(files[i].getName()).append("\"");
                        if (i < files.length - 1) sb.append(",");
                    }
                    sb.append("]");
                    return sb.toString();
                } catch (Exception e) {
                    return "[]";
                }
            }
        }, "YomuNative");

        // 处理 APK 下载和安装
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url.endsWith(".apk")) {
                downloadAndInstallApk(url);
            }
        });

        // 加载打包在 assets 里的 UI
        webView.loadUrl("file:///android_asset/index.html");

        checkStoragePermission();
    }

    private void checkStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            }
        }
    }

    private long downloadId = -1;

    private void downloadAndInstallApk(String url) {
        Toast.makeText(this, "正在下载更新...", Toast.LENGTH_LONG).show();

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("Yomu 更新");
        request.setDescription("正在下载最新版本...");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "yomu-latest.apk");

        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        downloadId = dm.enqueue(request);

        // 监听下载完成
        registerReceiver(new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id == downloadId) {
                    installApk();
                    unregisterReceiver(this);
                }
            }
        }, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
    }

    private void installApk() {
        File file = new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS), "yomu-latest.apk");

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.fromFile(file),
                "application/vnd.android.package-archive");
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(intent);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            webView.evaluateJavascript("document.dispatchEvent(new CustomEvent('volumekey', {detail: {direction: 'down'}}))", null);
            return true; // 拦截，不调节音量
        }
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            webView.evaluateJavascript("document.dispatchEvent(new CustomEvent('volumekey', {detail: {direction: 'up'}}))", null);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
