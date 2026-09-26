package com.khitta.tasks;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Alarms do not survive a reboot, so everything is re-armed from {@code alarms.json} after
 * {@code BOOT_COMPLETED}, clock/time-zone changes and app updates.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        final String action = intent == null ? "" : String.valueOf(intent.getAction());
        final PendingResult pending = goAsync();
        final ExecutorService ex = Executors.newSingleThreadExecutor();
        ex.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Notifier.ensureChannels(Lang.wrap(app));
                    int refired = AlarmScheduler.rearmFromDisk(app);
                    Log.i(Store.TAG, "boot rearm after " + action + " (refired=" + refired + ")");
                } catch (Throwable t) {
                    Log.w(Store.TAG, "boot rearm failed", t);
                } finally {
                    pending.finish();
                    ex.shutdown();
                }
            }
        });
    }
}
