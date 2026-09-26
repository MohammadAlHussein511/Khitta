package com.khitta.tasks;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The whole contract between the web layer and Android. Every method is called on the WebView's
 * JavaBridge thread, so anything touching the UI is posted to the main thread explicitly.
 */
public class Bridge {

    private final MainActivity activity;
    private volatile boolean backIntercept = false;
    private volatile String launchPayload = null;

    public Bridge(MainActivity activity) {
        this.activity = activity;
    }

    // ------------------------------------------------------------ helpers

    WebView webView() {
        return activity.webView();
    }

    void callJs(final String js) {
        if (js == null) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                WebView w = webView();
                if (w != null) {
                    try {
                        w.evaluateJavascript(js, null);
                    } catch (Throwable t) {
                        Log.w(Store.TAG, "evaluateJavascript failed", t);
                    }
                }
            }
        });
    }

    void pushInsets(int top, int right, int bottom, int left) {
        callJs("window.K&&K.app&&K.app.setInsets&&K.app.setInsets(" + top + "," + right + "," + bottom + "," + left + ")");
    }

    boolean isBackIntercept() {
        return backIntercept;
    }

    void setLaunchPayload(String json) {
        launchPayload = json;
    }

    void pushLaunchPayload() {
        String p = launchPayload;
        if (p == null) return;
        launchPayload = null;
        callJs("window.K&&K.app&&K.app.onLaunchPayload&&K.app.onLaunchPayload(" + JSONObject.quote(p) + ")");
    }

    // ------------------------------------------------------------ identity

    @JavascriptInterface
    public String hello() {
        return "khitta-bridge/1";
    }

    @JavascriptInterface
    public String appInfo() {
        JSONObject o = new JSONObject();
        try {
            Context c = activity;
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            o.put("versionName", String.valueOf(pi.versionName));
            o.put("versionCode", pi.versionCode);
            o.put("sdkInt", Build.VERSION.SDK_INT);
            o.put("model", String.valueOf(Build.MODEL));
            o.put("manufacturer", String.valueOf(Build.MANUFACTURER));
            o.put("lang", Lang.current(c));
            o.put("bridge", 1);
        } catch (Throwable t) {
            Log.w(Store.TAG, "appInfo failed", t);
        }
        return o.toString();
    }

    // ------------------------------------------------------------ storage

    @JavascriptInterface
    public String loadState() {
        return Store.readState(activity);
    }

    @JavascriptInterface
    public boolean saveState(String json) {
        return Store.writeState(activity, json);
    }

    @JavascriptInterface
    public long storageBytes() {
        File f = Store.stateFile(activity);
        return f.isFile() ? f.length() : 0L;
    }

    @JavascriptInterface
    public boolean hasBackup() {
        File f = Store.backupFile(activity);
        return f.isFile() && f.length() > 0;
    }

    /** One-generation safety net: read the previous good state document. */
    @JavascriptInterface
    public String loadBackup() {
        return Store.readText(Store.backupFile(activity));
    }

    /** Writes a user-initiated JSON backup into Downloads. Returns the display path or "". */
    @JavascriptInterface
    public String exportBackup(String json, String fileName) {
        if (json == null || json.length() == 0) return "";
        String name = (fileName == null || fileName.length() == 0)
                ? "khitta-backup-" + System.currentTimeMillis() + ".json" : fileName;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return "";
                OutputStream os = activity.getContentResolver().openOutputStream(uri);
                if (os == null) return "";
                try {
                    os.write(json.getBytes("UTF-8"));
                } finally {
                    os.close();
                }
                cv.clear();
                cv.put(MediaStore.Downloads.IS_PENDING, 0);
                activity.getContentResolver().update(uri, cv, null, null);
                return "Downloads/" + name;
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                    activity.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                            == PackageManager.PERMISSION_GRANTED) {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) return "";
                File out = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(out);
                try {
                    fos.write(json.getBytes("UTF-8"));
                } finally {
                    fos.close();
                }
                return out.getAbsolutePath();
            }
            return "NEED_PERMISSION";
        } catch (Throwable t) {
            Log.w(Store.TAG, "export failed", t);
            return "";
        }
    }

    // ------------------------------------------------------------ alarms

    @JavascriptInterface
    public boolean scheduleAll(String alarmsJson) {
        if (alarmsJson == null || alarmsJson.length() == 0) return false;
        try {
            JSONObject root = new JSONObject(alarmsJson);
            int horizon = root.optInt("horizonDays", 60);
            JSONArray arr = root.optJSONArray("entries");
            List<Store.Entry> list = new ArrayList<Store.Entry>();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    Store.Entry e = Store.Entry.from(arr.optJSONObject(i));
                    if (e != null) list.add(e);
                }
            }
            AlarmScheduler.syncAll(activity, list, horizon);
            return true;
        } catch (JSONException e) {
            Log.w(Store.TAG, "scheduleAll: bad payload", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean cancelAllAlarms() {
        AlarmScheduler.cancelAll(activity);
        return true;
    }

    @JavascriptInterface
    public String alarmState() {
        JSONObject o = new JSONObject();
        try {
            o.put("canExact", AlarmScheduler.canExact(activity));
            o.put("notificationsEnabled", Notifier.enabled(activity));
            o.put("armed", Store.readAlarms(activity).size());
            boolean denied = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                denied = activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED;
            }
            o.put("notificationsDenied", denied);
        } catch (Throwable t) {
            Log.w(Store.TAG, "alarmState failed", t);
        }
        return o.toString();
    }

    @JavascriptInterface
    public boolean testReminder(String json) {
        String title = activity.getString(R.string.notif_default_title);
        String body = "";
        try {
            JSONObject o = new JSONObject(json == null ? "{}" : json);
            title = o.optString("title", title);
            body = o.optString("body", body);
        } catch (Throwable ignored) {
        }
        Notifier.showTest(Lang.wrap(activity), title, body);
        return true;
    }

    // ------------------------------------------------------------ chrome / ui

    /** Applies the in-app theme + language to the native chrome (system bars, resources). */
    @JavascriptInterface
    public void applyChrome(final String json) {
        String theme = "system";
        String lang = Lang.current(activity);
        try {
            JSONObject o = new JSONObject(json == null ? "{}" : json);
            theme = o.optString("theme", theme);
            lang = o.optString("lang", lang);
        } catch (Throwable ignored) {
        }
        final String fTheme = theme;
        final String fLang = lang;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                applyLocale(fLang);
                applyBars(fTheme);
            }
        });
    }

    private void applyLocale(String lang) {
        if (lang == null) return;
        Lang.invalidate();
        Locale locale = new Locale(lang);
        try {
            android.content.res.Configuration cfg =
                    new android.content.res.Configuration(activity.getResources().getConfiguration());
            cfg.setLocale(locale);
            cfg.setLayoutDirection(locale);
            activity.getResources().updateConfiguration(cfg, activity.getResources().getDisplayMetrics());
            activity.getApplication().getResources()
                    .updateConfiguration(cfg, activity.getApplication().getResources().getDisplayMetrics());
        } catch (Throwable t) {
            Log.w(Store.TAG, "applyLocale failed", t);
        }
    }

    private void applyBars(String theme) {
        Window w = activity.getWindow();
        if (w == null) return;
        boolean darkUi = "dark".equals(theme);       // dark UI ⇒ light (white) system-bar icons
        boolean lightIcons = !darkUi;                // APPEARANCE_LIGHT_* means "draw dark icons"
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController ic = w.getInsetsController();
                if (ic != null) {
                    ic.setSystemBarsAppearance(
                            lightIcons ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                    ic.setSystemBarsAppearance(
                            lightIcons ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0,
                            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                }
            } else {
                View decor = w.getDecorView();
                int flags = decor.getSystemUiVisibility();
                int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    light |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
                flags = lightIcons ? (flags | light) : (flags & ~light);
                decor.setSystemUiVisibility(flags);
            }
        } catch (Throwable t) {
            Log.w(Store.TAG, "applyBars failed", t);
        }
    }

    @JavascriptInterface
    public void setBackIntercept(boolean value) {
        backIntercept = value;
    }

    @JavascriptInterface
    public void vibrate(int millis) {
        try {
            Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            int ms = Math.max(1, Math.min(millis, 400));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(ms);
            }
        } catch (Throwable ignored) {
        }
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.requestNotificationPermission();
            }
        });
    }

    /** "notifications" | "exactAlarms" | "battery" | "appDetails" */
    @JavascriptInterface
    public void openSystemSettings(final String kind) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.openSystemSettings(kind);
            }
        });
    }

    @JavascriptInterface
    public void startImport() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.startImportPicker();
            }
        });
    }

    @JavascriptInterface
    public String consumeLaunchPayload() {
        String p = launchPayload;
        launchPayload = null;
        return p == null ? "" : p;
    }

    @JavascriptInterface
    public void closeApp() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.finishAndRemoveTask();
            }
        });
    }
}
