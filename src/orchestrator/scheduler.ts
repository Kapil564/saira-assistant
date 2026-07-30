import cron from 'node-cron';
import notifier from 'node-notifier';
import { db } from '../db';
import { getDueReminders, markReminderNotified } from '../db/actions';
import type { TTSProvider } from '../providers/tts';

export function startReminderPolling(tts: TTSProvider) {
  cron.schedule('* * * * *', async () => {
    const due = await getDueReminders(db, new Date());
    for (const reminder of due) {
      const message = `Reminder: ${reminder.text}`;
      notifier.notify({ title: 'Saira', message });
      await tts.speak(message);
      await markReminderNotified(db, reminder.id);
    }
  });
}
