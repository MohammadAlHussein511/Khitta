package com.khitta.tasks;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Notification channels and the reminder notification itself.
 *
 * <p>Titles, bodies and action labels are supplied by the JS layer (already localised in the
 * language the user picked), so notifications always match the in-app language.
 */
public final class Notifier {

    public static final String CH_REMINDERS = "reminders";

    private static int immutableFlag() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    private Notifier() {
    }

    public static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CH_REMINDERS,
                c.getString(R.string.channel_reminders),
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(c.getString(R.string.channel_reminders_desc));
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 260, 120, 260});
        ch.enableLights(true);
        ch.setShowBadge(true);
        ch.setBypassDnd(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    public static boolean enabled(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) return nm.areNotificationsEnabled();
        return true;
    }

    public static void cancel(Context c, int id) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(id);
    }

    private static PendingIntent openIntent(Context c, Store.Entry e) {
        Intent i = new Intent(c, MainActivity.class);
        i.setAction(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra("from", "notification");
        i.putExtra("taskId", e.taskId);
        i.putExtra("occAt", e.occAt);
        i.putExtra("code", e.code);
        return PendingIntent.getActivity(c, e.code * 3 + 1, i, immutableFlag());
    }

    private static PendingIntent actionIntent(Context c, String action, Store.Entry e, int slot) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.setAction(action);
        i.setPackage(c.getPackageName());
        i.putExtra("code", e.code);
        i.putExtra("taskId", e.taskId);
        i.putExtra("occAt", e.occAt);
        i.putExtra("title", e.title);
        i.putExtra("body", e.body);
        i.putExtra("openLabel", e.openLabel);
        i.putExtra("doneLabel", e.doneLabel);
        i.putExtra("snoozeLabel", e.snoozeLabel);
        return PendingIntent.getBroadcast(c, e.code * 3 + slot, i, immutableFlag());
    }

    public static void showReminder(Context c, Store.Entry e) {
        if (e == null) return;
        ensureChannels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        String title = e.title != null && e.title.length() > 0 ? e.title : c.getString(R.string.notif_default_title);
        String body = e.body == null ? "" : e.body;

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(c, CH_REMINDERS);
        } else {
            b = new Notification.Builder(c).setPriority(Notification.PRIORITY_HIGH);
        }

        b.setSmallIcon(R.drawable.ic_stat_khitta)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().setBigContentTitle(title).bigText(body))
                .setContentIntent(openIntent(c, e))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setColor(c.getResources().getColor(R.color.brand))
                .setWhen(e.occAt > 0 ? e.occAt : System.currentTimeMillis())
                .setShowWhen(true);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            b.setDefaults(Notification.DEFAULT_ALL);
        }

        String doneLabel = e.doneLabel != null && e.doneLabel.length() > 0
                ? e.doneLabel : c.getString(R.string.notif_action_done);
        String snoozeLabel = e.snoozeLabel != null && e.snoozeLabel.length() > 0
                ? e.snoozeLabel : c.getString(R.string.notif_action_snooze);

        // Action icons are ignored by the modern template; 0 keeps the buttons text-only.
        b.addAction(new Notification.Action.Builder(
                0, doneLabel, actionIntent(c, ReminderReceiver.ACTION_DONE, e, 2)).build());
        b.addAction(new Notification.Action.Builder(
                0, snoozeLabel, actionIntent(c, ReminderReceiver.ACTION_SNOOZE, e, 3)).build());

        try {
            nm.notify(e.code, b.build());
        } catch (Throwable t) {
            android.util.Log.w(Store.TAG, "notify failed", t);
        }
    }

    /** Immediate test notification, triggered from Settings. */
    public static void showTest(Context c, String title, String body) {
        Store.Entry e = new Store.Entry();
        e.code = Store.SNOOZE_CODE_BASE - 1;
        e.taskId = "";
        e.occAt = System.currentTimeMillis();
        e.title = title;
        e.body = body;
        showReminder(c, e);
    }
}
