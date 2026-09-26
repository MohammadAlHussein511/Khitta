package com.khitta.tasks;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Receives reminder triggers from {@link AlarmManager} — including when the app process is dead
 * (Android starts it on demand because the receiver is declared in the manifest) — and the
 * notification actions (mark done / snooze / dismiss).
 */
public class ReminderReceiver extends BroadcastReceiver {

    public static final String ACTION_FIRE = "com.khitta.tasks.action.REMINDER";
    public static final String ACTION_DONE = "com.khitta.tasks.action.REMINDER_DONE";
    public static final String ACTION_SNOOZE = "com.khitta.tasks.action.REMINDER_SNOOZE";
    public static final String ACTION_DISMISS = "com.khitta.tasks.action.REMINDER_DISMISS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        final Context app = Lang.wrap(context.getApplicationContext());
        final Intent in = new Intent(intent);
        final PendingResult pending = goAsync();
        final ExecutorService ex = Executors.newSingleThreadExecutor();
        ex.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    handle(app, in);
                } catch (Throwable t) {
                    Log.w(Store.TAG, "reminder handling failed", t);
                } finally {
                    pending.finish();
                    ex.shutdown();
                }
            }
        });
    }

    private static Store.Entry entryFrom(Intent in) {
        Store.Entry e = new Store.Entry();
        e.code = in.getIntExtra("code", 0);
        e.taskId = in.getStringExtra("taskId") == null ? "" : in.getStringExtra("taskId");
        e.occAt = in.getLongExtra("occAt", 0L);
        e.at = in.getLongExtra("at", e.occAt);
        e.title = in.getStringExtra("title") == null ? "" : in.getStringExtra("title");
        e.body = in.getStringExtra("body") == null ? "" : in.getStringExtra("body");
        e.openLabel = in.getStringExtra("openLabel") == null ? "" : in.getStringExtra("openLabel");
        e.doneLabel = in.getStringExtra("doneLabel") == null ? "" : in.getStringExtra("doneLabel");
        e.snoozeLabel = in.getStringExtra("snoozeLabel") == null ? "" : in.getStringExtra("snoozeLabel");
        return e;
    }

    private static void handle(Context c, Intent in) {
        String action = in.getAction();
        int code = in.getIntExtra("code", 0);
        String taskId = in.getStringExtra("taskId");
        long occAt = in.getLongExtra("occAt", 0L);

        if (ACTION_DONE.equals(action)) {
            Notifier.cancel(c, code);
            if (taskId != null && taskId.length() > 0) {
                Store.markOccurrenceDone(c, taskId, occAt, false);
                // Non-repeating tasks are closed by the mutation above: drop their alarms.
                if (isClosed(c, taskId)) consumeTask(c, taskId);
                else consume(c, code);
            } else {
                consume(c, code);
            }
            return;
        }

        if (ACTION_SNOOZE.equals(action)) {
            Notifier.cancel(c, code);
            Store.Entry e = entryFrom(in);
            e.code = code >= Store.SNOOZE_CODE_BASE ? code : Store.SNOOZE_CODE_BASE + code;
            e.at = System.currentTimeMillis() + Store.SNOOZE_MILLIS;
            e.snooze = true;
            List<Store.Entry> all = Store.readAlarms(c);
            List<Store.Entry> next = new ArrayList<Store.Entry>();
            for (Store.Entry o : all) {
                if (o.code != e.code) next.add(o);
            }
            next.add(e);
            Store.writeAlarms(c, next, 60);
            AlarmScheduler.schedule(c, e);
            return;
        }

        if (ACTION_DISMISS.equals(action)) {
            Notifier.cancel(c, code);
            consume(c, code);
            return;
        }

        // Default: the reminder fired.
        Store.Entry e = entryFrom(in);
        if (e.title.length() == 0) e.title = c.getString(R.string.notif_default_title);
        Notifier.showReminder(c, e);
        consume(c, code);
    }

    private static boolean isClosed(Context c, String taskId) {
        org.json.JSONObject st = Store.readStateJson(c);
        if (st == null) return false;
        org.json.JSONArray tasks = st.optJSONArray("tasks");
        if (tasks == null) return false;
        for (int i = 0; i < tasks.length(); i++) {
            org.json.JSONObject t = tasks.optJSONObject(i);
            if (t != null && taskId.equals(t.optString("id"))) return t.optLong("closedAt", 0L) > 0L;
        }
        return false;
    }

    /** Removes a consumed entry from disk so a reboot cannot re-fire it. */
    private static void consume(Context c, int code) {
        List<Store.Entry> all = Store.readAlarms(c);
        List<Store.Entry> next = new ArrayList<Store.Entry>();
        for (Store.Entry e : all) {
            if (e.code != code) next.add(e);
        }
        if (next.size() != all.size()) Store.writeAlarms(c, next, 60);
    }

    /** Removes every pending entry of a task (used when the series is finished). */
    private static void consumeTask(Context c, String taskId) {
        if (taskId == null || taskId.length() == 0) return;
        List<Store.Entry> all = Store.readAlarms(c);
        List<Store.Entry> next = new ArrayList<Store.Entry>();
        for (Store.Entry e : all) {
            if (taskId.equals(e.taskId)) AlarmScheduler.cancel(c, e.code);
            else next.add(e);
        }
        Store.writeAlarms(c, next, 60);
    }
}
