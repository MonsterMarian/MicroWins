package cz.microwins.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Synchronizace kalendáře na pozadí (co 15 minut, plánuje ji
 * {@link CalendarSyncPlugin#background}). S vypnutou automatickou
 * synchronizací účtů by jinak schůzky z Googlu do telefonu nepřišly, dokud
 * se appka neotevře. Jen si řekne o ruční synchronizaci - zbytek udělá
 * Google synchronizace sama.
 */
public class CalendarSyncWorker extends Worker {

    public CalendarSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        CalendarSyncPlugin.requestCalendarSync(false);
        return Result.success();
    }
}
