package cz.microwins.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.ContentObserver;
import android.database.Cursor;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.CalendarContract;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.TimeUnit;

/**
 * Synchronizace kalendáře telefonu s Googlem na žádost appky.
 *
 * Android posílá změny kalendáře do Googlu sám jen se zapnutou automatickou
 * synchronizací účtů. Bez ní by bloky zapsané z time boxu zůstaly v telefonu
 * a schůzky z Googlu by do něj nedorazily. Ruční synchronizace (totéž co
 * „Synchronizovat teď“ v Nastavení) jede i bez ní.
 *
 * Synchronizuje se kalendář **všech** účtů, ne jen toho vybraného: žádost o
 * konkrétní účet Android od Androidu 8 tiše zahodí, když k němu appka nemá
 * přístup (cizí Google účet ho nemá nikdy). Žádost bez účtu tu kontrolu nemá.
 *
 * Vedle toho dává vědět, když se kalendář v telefonu změní, ať mřížka ukáže,
 * co synchronizace přinesla. Oprávnění ke kalendáři vyžádá plugin
 * @ebarooni/capacitor-calendar - bez něj `watch` skončí chybou.
 */
@CapacitorPlugin(name = "CalendarSync")
public class CalendarSyncPlugin extends Plugin {

    private ContentObserver observer;

    private static final String BACKGROUND_WORK = "microwins-calendar-sync";

    /** Ruční synchronizace kalendářů; `upload` = hlavně odeslat změny z telefonu. */
    @PluginMethod
    public void requestSync(PluginCall call) {
        requestCalendarSync(Boolean.TRUE.equals(call.getBoolean("upload", false)));
        call.resolve();
    }

    /** Totéž pro {@link CalendarSyncWorker} na pozadí. */
    static void requestCalendarSync(boolean upload) {
        Bundle extras = new Bundle();
        extras.putBoolean(ContentResolver.SYNC_EXTRAS_MANUAL, true);
        extras.putBoolean(ContentResolver.SYNC_EXTRAS_EXPEDITED, true);
        if (upload) extras.putBoolean(ContentResolver.SYNC_EXTRAS_UPLOAD, true);
        ContentResolver.requestSync(null, CalendarContract.AUTHORITY, extras);
    }

    /**
     * Zapne/vypne synchronizaci na pozadí co 15 minut (nejkratší interval,
     * který WorkManager dovolí), jen se sítí. Opakované zapnutí nic nemění.
     */
    @PluginMethod
    public void background(PluginCall call) {
        WorkManager work = WorkManager.getInstance(getContext());
        if (Boolean.TRUE.equals(call.getBoolean("enabled", false))) {
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(CalendarSyncWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
            work.enqueueUniquePeriodicWork(BACKGROUND_WORK, ExistingPeriodicWorkPolicy.KEEP, request);
        } else {
            work.cancelUniqueWork(BACKGROUND_WORK);
        }
        call.resolve();
    }

    /**
     * Všechny události zrcadla (se značkou `microwins:` v popisu) v kalendáři
     * `calendarId`, bez ohledu na datum - událost posunutá v Googlu daleko
     * dopředu se tak nesplete se smazanou. Čte se tabulka událostí, ne
     * výskyty, a smazané řádky čekající na synchronizaci se vynechají.
     *
     * `ok` = kalendář existuje a stahuje události. Bez toho appka nesmí brát
     * chybějící události jako smazané.
     */
    @PluginMethod
    public void mirrorEvents(PluginCall call) {
        String calendarId = call.getString("calendarId");
        if (calendarId == null) {
            call.reject("Chybí calendarId");
            return;
        }
        ContentResolver cr = getContext().getContentResolver();
        JSObject result = new JSObject();
        JSArray events = new JSArray();
        try {
            long id = Long.parseLong(calendarId);
            try (Cursor c = cr.query(
                ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, id),
                new String[] { CalendarContract.Calendars.SYNC_EVENTS },
                null,
                null,
                null
            )) {
                result.put("ok", c != null && c.moveToFirst() && c.getInt(0) == 1);
            }
            try (Cursor c = cr.query(
                CalendarContract.Events.CONTENT_URI,
                new String[] {
                    CalendarContract.Events._ID,
                    CalendarContract.Events.TITLE,
                    CalendarContract.Events.DESCRIPTION,
                    CalendarContract.Events.DTSTART,
                    CalendarContract.Events.DTEND,
                    CalendarContract.Events.ALL_DAY,
                    CalendarContract.Events.RRULE,
                },
                CalendarContract.Events.CALENDAR_ID + "=? AND " +
                    CalendarContract.Events.DELETED + "=0 AND " +
                    CalendarContract.Events.DESCRIPTION + " LIKE ?",
                new String[] { calendarId, "%microwins:%" },
                null
            )) {
                while (c != null && c.moveToNext()) {
                    long start = c.getLong(3);
                    JSObject e = new JSObject();
                    e.put("id", String.valueOf(c.getLong(0)));
                    e.put("title", c.isNull(1) ? "" : c.getString(1));
                    e.put("description", c.isNull(2) ? "" : c.getString(2));
                    e.put("startDate", start);
                    // Opakovaná událost nemá konec, jen délku - pro zrcadlo stačí začátek.
                    e.put("endDate", c.isNull(4) ? start : c.getLong(4));
                    e.put("allDay", c.getInt(5) == 1);
                    e.put("recurring", !c.isNull(6) && !c.getString(6).isEmpty());
                    events.put(e);
                }
            }
        } catch (Exception e) {
            call.reject("Kalendář nejde přečíst: " + e.getMessage());
            return;
        }
        result.put("events", events);
        call.resolve(result);
    }

    /** Začne hlásit změny kalendáře událostí `change`. Opakované volání nic nedělá. */
    @PluginMethod
    public void watch(PluginCall call) {
        if (observer == null) {
            ContentObserver next = new ContentObserver(new Handler(Looper.getMainLooper())) {
                @Override
                public void onChange(boolean selfChange) {
                    notifyListeners("change", null);
                }
            };
            try {
                getContext().getContentResolver().registerContentObserver(CalendarContract.Events.CONTENT_URI, true, next);
            } catch (SecurityException e) {
                call.reject("Bez přístupu ke kalendáři");
                return;
            }
            observer = next;
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (observer != null) getContext().getContentResolver().unregisterContentObserver(observer);
        observer = null;
    }
}
