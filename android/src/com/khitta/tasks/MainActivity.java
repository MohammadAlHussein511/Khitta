package com.khitta.tasks;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;

/**
 * Thin host for the application: a hardened {@link WebView} plus the native services the web
 * layer cannot provide (exact alarms, notifications from a dead process, app-private storage,
 * haptics, system settings deep links, edge-to-edge insets).
 */
public class MainActivity extends Activity {

    private static final int REQ_NOTIFICATIONS = 4201;

    private WebView web;
    private Bridge bridge;
    private boolean pageReady = false;

    WebView webView() {
        return web;
    }

    @Override
    protected void attachBaseContext(Context newBase) {
        super.attachBaseContext(Lang.wrap(newBase));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Notifier.ensureChannels(Lang.wrap(this));
        setupWindow();

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);

        configureWebView();
        bridge = new Bridge(this);
        web.addJavascriptInterface(bridge, "NativeBridge");
        applyInsetsListener();
        handleIntent(getIntent());

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(Store.START_URL);
        }
    }

    // ------------------------------------------------------------------ window

    private void setupWindow() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            w.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private void applyInsetsListener() {
        web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int t, b, l, r, ime;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                            | WindowInsets.Type.displayCutout());
                    Insets kbd = insets.getInsets(WindowInsets.Type.ime());
                    t = bars.top;
                    b = bars.bottom;
                    l = bars.left;
                    r = bars.right;
                    // The IME inset rect spans [keyboard top, screen bottom]: its HEIGHT is
                    // bottom - top (subtracting the nav bar here was wrong and inflated the
                    // keyboard padding on real devices).
                    ime = Math.max(0, kbd.bottom - kbd.top);
                } else {
                    t = insets.getSystemWindowInsetTop();
                    b = insets.getSystemWindowInsetBottom();
                    l = insets.getSystemWindowInsetLeft();
                    r = insets.getSystemWindowInsetRight();
                    // No IME inset type before R: derive the keyboard height from the
                    // visible display frame so sheets still lift above it.
                    android.graphics.Rect visible = new android.graphics.Rect();
                    if (web != null) web.getWindowVisibleDisplayFrame(visible);
                    int screenH = web != null && web.getRootView() != null ? web.getRootView().getHeight() : 0;
                    ime = Math.max(0, screenH - visible.bottom - b);
                }
                if (bridge != null) bridge.pushInsets(t, r, b, l, ime);
                return insets;
            }
        });
    }

    private void configureWebView() {
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(false);
        ws.setGeolocationEnabled(false);
        ws.setAllowFileAccess(true);              // required for file:///android_asset sub-resources
        ws.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            ws.setAllowFileAccessFromFileURLs(false);
            ws.setAllowUniversalAccessFromFileURLs(false);
        }
        ws.setSupportZoom(false);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setTextZoom(100);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setJavaScriptCanOpenWindowsAutomatically(false);
        ws.setMediaPlaybackRequiresUserGesture(true);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        // We own theming in CSS; never let the WebView re-colour our palette.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ws.setAlgorithmicDarkeningAllowed(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ws.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setScrollBarStyle(View.SCROLLBARS_OUTSIDE_OVERLAY);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Throwable ignored) {
                    }
                    return true;
                }
                return false; // keep file:///android_asset navigation inside the WebView
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (bridge != null) {
                    bridge.pushInsets(0, 0, 0, 0); // replaced by the real values below
                    view.requestApplyInsets();
                    bridge.pushLaunchPayload();
                }
                applyStoredChrome();
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.w(Store.TAG, "webview error " + errorCode + " " + description + " " + failingUrl);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(Store.TAG, "[web] " + m.messageLevel() + " " + m.message()
                        + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
    }

    private void applyStoredChrome() {
        if (bridge == null) return;
        JSONObject prefs = Store.prefs(this);
        bridge.applyChrome(prefs.toString());
    }

    // ------------------------------------------------------------------ intents

    private void handleIntent(Intent intent) {
        if (intent == null || bridge == null) return;
        String from = intent.getStringExtra("from");
        if (!"notification".equals(from)) return;
        try {
            JSONObject o = new JSONObject();
            o.put("from", "notification");
            o.put("taskId", intent.getStringExtra("taskId") == null ? "" : intent.getStringExtra("taskId"));
            o.put("occAt", intent.getLongExtra("occAt", 0L));
            o.put("code", intent.getIntExtra("code", 0));
            bridge.setLaunchPayload(o.toString());
            if (pageReady) bridge.pushLaunchPayload();
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        applyStoredChrome();
        if (pageReady && bridge != null) {
            // The native layer may have mutated state.json from a notification action.
            bridge.callJs("window.K&&K.app&&K.app.syncFromDisk&&K.app.syncFromDisk()");
            bridge.pushLaunchPayload();
        }
    }

    @Override
    protected void onPause() {
        if (bridge != null) {
            bridge.callJs("window.K&&K.app&&K.app.flush&&K.app.flush()");
        }
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.removeAllViews();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (bridge != null && bridge.isBackIntercept()) {
            bridge.callJs("window.K&&K.app&&K.app.onBack&&K.app.onBack()");
            return;
        }
        super.onBackPressed();
    }

    // ------------------------------------------------------------------ permissions

    void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
                return;
            }
        }
        if (bridge != null) bridge.callJs("window.K&&K.app&&K.app.onPermissionResult&&K.app.onPermissionResult('notifications',"
                + (Notifier.enabled(this) ? "true" : "false") + ")");
    }

    void openSystemSettings(String kind) {
        Intent i = null;
        Uri self = Uri.parse("package:" + getPackageName());
        try {
            if ("notifications".equals(kind) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            } else if ("exactAlarms".equals(kind) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, self);
            } else if ("battery".equals(kind)) {
                i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            } else {
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, self);
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Throwable t) {
            try {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, self)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_NOTIFICATIONS && bridge != null) {
            bridge.callJs("window.K&&K.app&&K.app.onPermissionResult&&K.app.onPermissionResult('notifications',"
                    + (granted ? "true" : "false") + ")");
        }
    }

    // ------------------------------------------------------------------ import / export

}
