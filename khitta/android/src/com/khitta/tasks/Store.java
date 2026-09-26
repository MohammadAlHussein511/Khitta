package com.khitta.tasks;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Persistence for the whole application.
 *
 * <p>Two documents live in the app-private internal storage directory:
 * <ul>
 *   <li>{@code state.json}  — the single source of truth (settings + tasks + completions).
 *       Written by the JS layer, read at boot and on resume. The native layer only ever
 *       performs two narrow mutations on it (mark an occurrence done / close a task) so
 *       that a notification action can work while the UI process is dead.</li>
 *   <li>{@code alarms.json} — a pre-expanded reminder schedule produced by the JS recurrence
 *       engine. Keeping the expansion in JS means no recurrence maths has to be duplicated
 *       in Java; the receivers simply arm what is written here.</li>
 * </ul>
 *
 * <p>All writes are atomic (tmp file + rename) and keep a one-generation backup.
 */
public final class Store {

    public static final String TAG = "Khitta";
    public static final String START_URL = "file:///android_asset/www/index.html";

    /** Refuse absurd payloads; protects the device from a runaway state document. */
    public static final int MAX_STATE_BYTES = 12 * 1024 * 1024;

    /** Native-owned alarm request codes start here so they never collide with JS-owned ones. */
    public static final int SNOOZE_CODE_BASE = 900000;

    public static final long SNOOZE_MILLIS = 10 * 60 * 1000L;

    private static final Charset UTF8 = Charset.forName("UTF-8");

    private Store() {
    }

    // ---------------------------------------------------------------- files

    public static File stateFile(Context c) {
        return new File(c.getFilesDir(), "state.json");
    }

    public static File backupFile(Context c) {
        return new File(c.getFilesDir(), "state.backup.json");
    }

    public static File alarmsFile(Context c) {
        return new File(c.getFilesDir(), "alarms.json");
    }

    private static void close(InputStream s) {
        if (s != null) {
            try {
                s.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static void close(OutputStream s) {
        if (s != null) {
            try {
                s.close();
            } catch (IOException ignored) {
            }
        }
    }

    public static String readText(File f) {
        if (f == null || !f.isFile()) return "";
        long len = f.length();
        if (len <= 0 || len > MAX_STATE_BYTES) return len > MAX_STATE_BYTES ? "" : "";
        InputStream in = null;
        try {
            in = new FileInputStream(f);
            byte[] buf = new byte[(int) len];
            int read = 0;
            while (read < buf.length) {
                int n = in.read(buf, read, buf.length - read);
                if (n < 0) break;
                read += n;
            }
            return new String(buf, 0, read, UTF8);
        } catch (IOException e) {
            Log.w(TAG, "readText failed", e);
            return "";
        } finally {
            close(in);
        }
    }

    /** Atomic write: tmp file, fsync, rename over the target. */
    public static boolean writeText(File f, String text) {
        if (f == null || text == null) return false;
        File parent = f.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) return false;
        File tmp = new File(parent, f.getName() + ".tmp");
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(tmp);
            out.write(text.getBytes(UTF8));
            out.flush();
            try {
                out.getFD().sync();
            } catch (IOException ignored) {
                // best effort
            }
            out.close();
            out = null;
            if (!tmp.renameTo(f)) {
                Log.w(TAG, "rename failed: " + tmp + " -> " + f);
                return false;
            }
            return true;
        } catch (IOException e) {
            Log.w(TAG, "writeText failed", e);
            return false;
        } finally {
            close(out);
            if (tmp.exists()) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            }
        }
    }

    private static boolean copy(File src, File dst) {
        InputStream in = null;
        OutputStream out = null;
        try {
            in = new FileInputStream(src);
            out = new FileOutputStream(dst);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
            return true;
        } catch (IOException e) {
            return false;
        } finally {
            close(in);
            close(out);
        }
    }

    // ---------------------------------------------------------------- state

    public static String readState(Context c) {
        return readText(stateFile(c));
    }

    public static boolean writeState(Context c, String json) {
        if (json == null) return false;
        byte[] bytes = json.getBytes(UTF8);
        if (bytes.length > MAX_STATE_BYTES) {
            Log.w(TAG, "state write rejected: too large (" + bytes.length + " bytes)");
            return false;
        }
        File f = stateFile(c);
        if (f.isFile() && f.length() > 0) {
            copy(f, backupFile(c)); // one-generation safety net
        }
        return writeText(f, json);
    }

    public static JSONObject readJson(File f) {
        String s = readText(f);
        if (s.length() == 0) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            Log.w(TAG, "invalid json in " + f.getName(), e);
            return null;
        }
    }

    public static JSONObject readStateJson(Context c) {
        return readJson(stateFile(c));
    }

    /** Language + theme as persisted by the JS layer; used to theme the native chrome. */
    public static JSONObject prefs(Context c) {
        JSONObject out = new JSONObject();
        try {
            out.put("lang", "ar");
            out.put("theme", "system");
            JSONObject st = readStateJson(c);
            if (st != null) {
                JSONObject s = st.optJSONObject("settings");
                if (s != null) {
                    out.put("lang", s.optString("lang", "ar"));
                    out.put("theme", s.optString("theme", "system"));
                }
            }
        } catch (JSONException ignored) {
        }
        return out;
    }

    /**
     * Mark a single occurrence of a task as completed. Called from the notification action,
     * i.e. while the UI process may be dead. Deliberately tiny and side-effect free.
     */
    public static boolean markOccurrenceDone(Context c, String taskId, long occAt, boolean closeTask) {
        if (taskId == null) return false;
        JSONObject st = readStateJson(c);
        if (st == null) return false;
        JSONArray tasks = st.optJSONArray("tasks");
        if (tasks == null) return false;
        long now = System.currentTimeMillis();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null || !taskId.equals(t.optString("id"))) continue;
            try {
                JSONObject done = t.optJSONObject("done");
                if (done == null) {
                    done = new JSONObject();
                    t.put("done", done);
                }
                done.put(String.valueOf(occAt), now);
                if (closeTask || "NONE".equals(t.optString("rec", "NONE"))) {
                    t.put("closedAt", now);
                }
                st.put("updatedAt", now);
                return writeState(c, st.toString());
            } catch (JSONException e) {
                Log.w(TAG, "markOccurrenceDone failed", e);
                return false;
            }
        }
        return false;
    }

    /** Undo a completion (used when the user re-opens the app after an accidental "done"). */
    public static boolean unmarkOccurrence(Context c, String taskId, long occAt) {
        JSONObject st = readStateJson(c);
        if (st == null) return false;
        JSONArray tasks = st.optJSONArray("tasks");
        if (tasks == null) return false;
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null || !taskId.equals(t.optString("id"))) continue;
            JSONObject done = t.optJSONObject("done");
            if (done == null) return false;
            done.remove(String.valueOf(occAt));
            try {
                st.put("updatedAt", System.currentTimeMillis());
            } catch (JSONException ignored) {
            }
            return writeState(c, st.toString());
        }
        return false;
    }

    // ---------------------------------------------------------------- alarms

    /** One armed reminder. Mirrors the JS {@code AlarmEntry} shape exactly. */
    public static final class Entry {
        public int code;
        public String taskId = "";
        public long occAt;
        public long at;
        public String title = "";
        public String body = "";
        public String openLabel = "";
        public String doneLabel = "";
        public String snoozeLabel = "";
        public boolean snooze;

        public static Entry from(JSONObject o) {
            if (o == null) return null;
            Entry e = new Entry();
            e.code = o.optInt("code", 0);
            e.taskId = o.optString("taskId", "");
            e.occAt = o.optLong("occAt", 0L);
            e.at = o.optLong("at", 0L);
            e.title = o.optString("title", "");
            e.body = o.optString("body", "");
            e.openLabel = o.optString("openLabel", "");
            e.doneLabel = o.optString("doneLabel", "");
            e.snoozeLabel = o.optString("snoozeLabel", "");
            e.snooze = o.optBoolean("snooze", false);
            return e;
        }

        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("code", code);
                o.put("taskId", taskId);
                o.put("occAt", occAt);
                o.put("at", at);
                o.put("title", title);
                o.put("body", body);
                o.put("openLabel", openLabel);
                o.put("doneLabel", doneLabel);
                o.put("snoozeLabel", snoozeLabel);
                o.put("snooze", snooze);
            } catch (JSONException ignored) {
            }
            return o;
        }
    }

    public static List<Entry> readAlarms(Context c) {
        List<Entry> out = new ArrayList<Entry>();
        JSONObject root = readJson(alarmsFile(c));
        if (root == null) return out;
        JSONArray arr = root.optJSONArray("entries");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            Entry e = Entry.from(arr.optJSONObject(i));
            if (e != null && e.code > 0) out.add(e);
        }
        Collections.sort(out, new Comparator<Entry>() {
            @Override
            public int compare(Entry a, Entry b) {
                return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0);
            }
        });
        return out;
    }

    public static boolean writeAlarms(Context c, List<Entry> entries, int horizonDays) {
        JSONArray arr = new JSONArray();
        for (Entry e : entries) arr.put(e.toJson());
        JSONObject root = new JSONObject();
        try {
            root.put("generatedAt", System.currentTimeMillis());
            root.put("horizonDays", horizonDays);
            root.put("count", arr.length());
            root.put("entries", arr);
        } catch (JSONException ignored) {
        }
        return writeText(alarmsFile(c), root.toString());
    }

    public static Entry findEntry(Context c, int code) {
        for (Entry e : readAlarms(c)) {
            if (e.code == code) return e;
        }
        return null;
    }
}
