package com.khitta.tasks;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;

import java.util.Locale;

/**
 * Pins the process locale to the language chosen inside the app, so resources, notification
 * chrome and layout direction follow the in-app setting rather than the device setting.
 */
public final class Lang {

    private static volatile String cached = null;

    private Lang() {
    }

    public static String current(Context c) {
        String l = cached;
        if (l == null) {
            l = read(c);
            cached = l;
        }
        return l;
    }

    /** Called by the JS layer through the bridge when the user switches language. */
    public static void invalidate() {
        cached = null;
    }

    private static String read(Context c) {
        try {
            String lang = Store.prefs(c).optString("lang", "ar");
            if ("en".equals(lang) || "ar".equals(lang)) return lang;
        } catch (Throwable ignored) {
        }
        return "ar";
    }

    public static boolean isRtl(String lang) {
        return !"en".equals(lang);
    }

    public static Context wrap(Context base) {
        String lang = read(base);
        cached = lang;
        Locale locale = new Locale(lang);
        Configuration config = new Configuration(base.getResources().getConfiguration());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            config.setLocale(locale);
            config.setLayoutDirection(locale);
            return base.createConfigurationContext(config);
        }
        config.locale = locale;
        base.getResources().updateConfiguration(config, base.getResources().getDisplayMetrics());
        return base;
    }
}
