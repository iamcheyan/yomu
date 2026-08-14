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
    private android.webkit.ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 10001;

    private String getRootPath() {
        return Environment.getExternalStorageDirectory().getAbsolutePath() + "/Yomu/data";
    }

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
                view.evaluateJavascript("window.DATA_ROOT = 'file://" + getRootPath() + "';", null);
                view.evaluateJavascript("window.IS_ANDROID = true;", null);
            }
        });

        // 本地导入/备份読み込み（<input type="file">）需要 file chooser 支持
        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             android.webkit.ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                // accept=".txt,.epub" 等扩展名列表不是合法 MIME，退回 */*
                String[] accept = params.getAcceptTypes();
                String a0 = (accept != null && accept.length > 0 && accept[0] != null)
                        ? accept[0].trim() : "";
                intent.setType((a0.isEmpty() || a0.contains(",") || a0.startsWith(".")) ? "*/*" : a0);
                try {
                    startActivityForResult(
                            Intent.createChooser(intent, "ファイルを選択"), FILE_CHOOSER_REQUEST);
                } catch (android.content.ActivityNotFoundException e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "ファイル選択アプリがありません", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        // 注册原生桥接，允许 JS 读写文件
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void saveFile(String filename, String content) {
                try {
                    File dir = new File(getRootPath());
                    if (!dir.exists()) dir.mkdirs();
                    File file = new File(dir, filename);
                    File parent = file.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
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
                    File file = new File(getRootPath(), filename);
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
                    File dir = new File(getRootPath());
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

            @android.webkit.JavascriptInterface
            public boolean fileExists(String filename) {
                try {
                    File file = new File(getRootPath(), filename);
                    return file.exists();
                } catch (Exception e) {
                    return false;
                }
            }

            @android.webkit.JavascriptInterface
            public boolean deleteFile(String filename) {
                try {
                    File file = new File(getRootPath(), filename);
                    if (file.isDirectory()) {
                        return deleteRecursive(file);
                    }
                    return file.exists() && file.delete();
                } catch (Exception e) {
                    return false;
                }
            }

            private boolean deleteRecursive(File fileOrDirectory) {
                if (fileOrDirectory.isDirectory()) {
                    File[] files = fileOrDirectory.listFiles();
                    if (files != null) {
                        for (File child : files) {
                            deleteRecursive(child);
                        }
                    }
                }
                return fileOrDirectory.delete();
            }

            @android.webkit.JavascriptInterface
            public boolean clearAllData() {
                try {
                    File dir = new File(getRootPath());
                    if (dir.exists() && dir.isDirectory()) {
                        File[] children = dir.listFiles();
                        if (children != null) {
                            for (File child : children) {
                                if (!deleteRecursive(child) && child.exists()) {
                                    return false;
                                }
                            }
                        }
                    }
                    if (!dir.exists() && !dir.mkdirs()) {
                        return false;
                    }
                    String[] remaining = dir.list();
                    return remaining == null || remaining.length == 0;
                } catch (Exception e) {
                    e.printStackTrace();
                    return false;
                }
            }

            @android.webkit.JavascriptInterface
            public String getExternalPath() {
                return getRootPath();
            }

            @android.webkit.JavascriptInterface
            public void downloadFile(final String url, final String filename) {
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            File root = new File(getRootPath());
                            File outFile = new File(root, filename);

                            // Support subdirectories (e.g., "dict/base.dat.gz")
                            File parentDir = outFile.getParentFile();
                            if (parentDir != null && !parentDir.exists()) {
                                parentDir.mkdirs();
                            }

                            java.net.URL u = new java.net.URL(url);
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) u.openConnection();
                            conn.setRequestMethod("GET");
                            conn.setConnectTimeout(15000);
                            conn.setReadTimeout(60000);
                            conn.connect();

                            int totalSize = conn.getContentLength();
                            java.io.InputStream is = conn.getInputStream();
                            java.io.FileOutputStream fos = new java.io.FileOutputStream(outFile);
                            byte[] buffer = new byte[8192];
                            int bytesRead;
                            long[] downloaded = {0};
                            while ((bytesRead = is.read(buffer)) != -1) {
                                fos.write(buffer, 0, bytesRead);
                                downloaded[0] += bytesRead;
                                final int progress = totalSize > 0 ? (int) (downloaded[0] * 100 / totalSize) : -1;
                                final long dlBytes = downloaded[0];
                                webView.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        webView.evaluateJavascript(
                                            "if(window.YomuNativeCallback) YomuNativeCallback.onDownloadProgress('" + filename + "'," + progress + "," + dlBytes + ")", null);
                                    }
                                });
                            }
                            fos.close();
                            is.close();
                            conn.disconnect();

                            webView.post(new Runnable() {
                                @Override
                                public void run() {
                                    webView.evaluateJavascript(
                                        "if(window.YomuNativeCallback) YomuNativeCallback.onDownloadComplete('" + filename + "')", null);
                                }
                            });
                        } catch (Exception e) {
                            e.printStackTrace();
                            final String errMsg = e.getMessage();
                            webView.post(new Runnable() {
                                @Override
                                public void run() {
                                    webView.evaluateJavascript(
                                        "if(window.YomuNativeCallback) YomuNativeCallback.onDownloadError('" + filename + "','" + errMsg + "')", null);
                                }
                            });
                        }
                    }
                }).start();
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
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
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
