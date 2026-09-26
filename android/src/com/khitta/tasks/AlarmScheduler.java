package com.khitta.tasks;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Arms reminders with the platform alarm clock.
 *
 * <p>The JS domain layer pre-expands the recurrence horizon and hands over a flat list of
 * concrete trigger times; this class only registers them. Because every future occurrence is
 * armed up front, the reminder chain does not depend on the app ever being opened again, and a
 * reboot simply re-arms what is on disk.
 *
 * <p>Exact alarms are used whenever the platform allows them ({@code USE_EXACT_ALARM} is
 * auto-granted on API 33+, {@code SCHEDULE_EXACT_ALARM} covers API 31–32, and nothing is needed
 * below that). If exact scheduling is unavailable the trigger degrades to a 60-second window
 * instead of failing silently. {@code setAlarmClock} is deliberately avoided: it would pin a
 * permanent alarm-clock icon in the status bar.
 */
public final class AlarmScheduler {

    /** Platform limit is 500 alarms per package; the JS layer caps itself below this. */
    public static final int MAX_ARMED = 450;

    private static final long INEXACT_WINDOW_MS = 60 * 1000L;

    private AlarmScheduler() {
    }

    private static AlarmManager am(Context c) {
        return (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    }

    private static int updateFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    public static boolean canExact(Context c) {
        AlarmManager am = am(c);
        if (am == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        try {
            return am.canScheduleExactAlarms();
        } catch (Throwable t) {
            return false;
        }
    }

    private static Intent fireIntent(Context c, Store.Entry e) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.setAction(ReminderReceiver.ACTION_FIRE);
        i.setPackage(c.getPackageName());
        if (e != null) {
            i.putExtra("code", e.code);
            i.putExtra("taskId", e.taskId);
            i.putExtra("occAt", e.occAt);
            i.putExtra("at", e.at);
            i.putExtra("title", e.title);
            i.putExtra("body", e.body);
            i.putExtra("openLabel", e.openLabel);
            i.putExtra("doneLabel", e.doneLabel);
            i.putExtra("snoozeLabel", e.snoozeLabel);
        }
        return i;
    }

    public static void schedule(Context c, Store.Entry e) {
        AlarmManager am = am(c);
        if (am == null || e == null || e.code <= 0) return;
        long now = System.currentTimeMillis();
        long at = e.at > now ? e.at : now + 1500L; // never silently drop a past reminder
        PendingIntent pi = PendingIntent.getBroadcast(c, e.code, fireIntent(c, e), updateFlags());
        try {
            if (canExact(c)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
                }
            } else {
                am.setWindow(AlarmManager.RTC_WAKEUP, at, INEXACT_WINDOW_MS, pi);
            }
        } catch (SecurityException se) {
            // Exact-alarm access revoked at runtime: fall back to an inexact window.
            try {
                am.setWindow(AlarmManager.RTC_WAKEUP, at, INEXACT_WINDOW_MS, pi);
            } catch (Throwable t) {
                Log.w(Store.TAG, "alarm fallback failed", t);
            }
        } catch (Throwable t) {
            Log.w(Store.TAG, "schedule failed for code " + e.code, t);
        }
    }

    public static void cancel(Context c, int code) {
        AlarmManager am = am(c);
        if (am == null || code <= 0) return;
        Intent i = new Intent(c, ReminderReceiver.class);
        i.setAction(ReminderReceiver.ACTION_FIRE);
        i.setPackage(c.getPackageName());
        int flags = PendingIntent.FLAG_NO_CREATE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(c, code, i, flags);
        if (pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }

    /**
     * Replaces the armed set with {@code jsEntries}, cancelling whatever disappeared and
     * preserving native-owned snooze alarms that JS knows nothing about.
     */
    public static void syncAll(Context c, List<Store.Entry> jsEntries, int horizonDays) {
        long now = System.currentTimeMillis();
        List<Store.Entry> old = Store.readAlarms(c);
        List<Store.Entry> next = new ArrayList<Store.Entry>();
        Set<Integer> codes = new HashSet<Integer>();

        if (jsEntries != null) {
            for (Store.Entry e : jsEntries) {
                if (e == null || e.code <= 0 || e.code >= Store.SNOOZE_CODE_BASE) continue;
                if (e.at <= now - 24L * 3600_000L) continue; // long-expired: drop
                if (codes.add(e.code)) next.add(e);
            }
        }
        for (Store.Entry e : old) {
            if (e.code >= Store.SNOOZE_CODE_BASE && e.at > now && codes.add(e.code)) next.add(e);
        }

        java.util.Collections.sort(next, new java.util.Comparator<Store.Entry>() {
            @Override
            public int compare(Store.Entry a, Store.Entry b) {
                return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0);
            }
        });
        if (next.size() > MAX_ARMED) next = new ArrayList<Store.Entry>(next.subList(0, MAX_ARMED));

        Set<Integer> keep = new HashSet<Integer>();
        for (Store.Entry e : next) keep.add(e.code);
        for (Store.Entry e : old) {
            if (!keep.contains(e.code)) cancel(c, e.code);
        }

        Store.writeAlarms(c, next, horizonDays);
        for (Store.Entry e : next) schedule(c, e);
        Log.i(Store.TAG, "alarms synced: " + next.size() + " armed (horizon " + horizonDays + "d)");
    }

    public static void cancelAll(Context c) {
        for (Store.Entry e : Store.readAlarms(c)) cancel(c, e.code);
        Store.writeAlarms(c, new ArrayList<Store.Entry>(), 0);
    }

    /**
     * Re-arms everything persisted on disk. Used after boot, clock/time-zone changes and app
     * updates. The most recent missed reminder is re-fired a few seconds later so that nothing
     * is silently lost; older misses are dropped to avoid a notification flood.
     */
    public static int rearmFromDisk(Context c) {
        long now = System.currentTimeMillis();
        List<Store.Entry> all = Store.readAlarms(c);
        List<Store.Entry> future = new ArrayList<Store.Entry>();
        List<Store.Entry> missed = new ArrayList<Store.Entry>();
        for (Store.Entry e : all) {
            if (e.at > now) future.add(e);
            else missed.add(e);
        }
        int refired = 0;
        if (!missed.isEmpty()) {
            Store.Entry last = missed.get(missed.size() - 1); // alarms.json is time-sorted
            last.at = now + 3000L;
            future.add(last);
            refired = 1;
            for (int i = 0; i < missed.size() - 1; i++) cancel(c, missed.get(i).code);
        }
        java.util.Collections.sort(future, new java.util.Comparator<Store.Entry>() {
            @Override
            public int compare(Store.Entry a, Store.Entry b) {
                return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0);
            }
        });
        Store.writeAlarms(c, future, 60);
        for (Store.Entry e : future) schedule(c, e);
        Log.i(Store.TAG, "rearmed " + future.size() + " alarms, refired " + refired + " missed");
        return refired;
    }
}
