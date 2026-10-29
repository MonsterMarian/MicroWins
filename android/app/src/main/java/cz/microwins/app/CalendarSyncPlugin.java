package cz.microwins.app;

import android.content.ContentResolver;
import android.database.ContentObserver;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.CalendarContract;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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

    /** Ruční synchronizace kalendářů; `upload` = hlavně odeslat změny z telefonu. */
    @PluginMethod
    public void requestSync(PluginCall call) {
        Bundle extras = new Bundle();
        extras.putBoolean(ContentResolver.SYNC_EXTRAS_MANUAL, true);
        extras.putBoolean(ContentResolver.SYNC_EXTRAS_EXPEDITED, true);
        if (Boolean.TRUE.equals(call.getBoolean("upload", false))) {
            extras.putBoolean(ContentResolver.SYNC_EXTRAS_UPLOAD, true);
        }
        ContentResolver.requestSync(null, CalendarContract.AUTHORITY, extras);
        call.resolve();
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
