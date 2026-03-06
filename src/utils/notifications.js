import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

// Notification handler — show banners while app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const NOTIF_ID_PREFIX = 'gozi_event_';

/**
 * Request permission to send notifications.
 * Returns true if granted.
 */
export async function requestNotificationPermission() {
  if (!Device.isDevice) return false; // simulatoarele nu suportă notificări reale

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedule a reminder for an event.
 * Trimite notificarea cu 1 oră înainte de eveniment (sau la ora curentă+5s dacă e în trecut — pentru test).
 * Returnează notification id sau null dacă nu are permisiune / evenimentul e mereu deschis.
 */
export async function scheduleEventReminder(event) {
  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) return null;

  // Evenimentele mereu deschise (dateISO: null) nu au reminder
  if (!event.dateISO) return null;

  // Build trigger date: ziua evenimentului, ora din event.time (ex: "20:00")
  let triggerDate = new Date(event.dateISO);
  if (event.time) {
    const [hh, mm] = event.time.split(':').map(Number);
    triggerDate.setHours(hh || 20, mm || 0, 0, 0);
  } else {
    triggerDate.setHours(20, 0, 0, 0); // default 20:00
  }

  // Reminder cu 1 oră înainte
  triggerDate = new Date(triggerDate.getTime() - 60 * 60 * 1000);

  // Dacă data e în trecut, schedule pentru 5 secunde (preview/test)
  const now = new Date();
  const isInPast = triggerDate <= now;
  const trigger = isInPast
    ? { seconds: 5 }
    : { date: triggerDate };

  const notifId = NOTIF_ID_PREFIX + event.id;

  // Anulăm orice reminder anterior pentru acest eveniment
  await cancelEventReminder(event.id);

  const id = await Notifications.scheduleNotificationAsync({
    identifier: notifId,
    content: {
      title: `🎉 ${event.title}`,
      body: isInPast
        ? `Test reminder: ${event.venue} — ${event.time || ''}`
        : `Începe în 1 oră la ${event.venue}${event.time ? ' (' + event.time + ')' : ''}`,
      data: { eventId: event.id },
      sound: true,
      // Android: canal de notificări cu prioritate HIGH
      channelId: 'gozi_reminders',
    },
    trigger,
  });

  return id;
}

/**
 * Cancel reminder for a specific event.
 */
export async function cancelEventReminder(eventId) {
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIF_ID_PREFIX + eventId);
  } catch (_) {}
}

/**
 * Cancel all GOZI reminders.
 */
export async function cancelAllReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const goziNotifs = scheduled.filter(n => n.identifier.startsWith(NOTIF_ID_PREFIX));
  await Promise.all(goziNotifs.map(n =>
    Notifications.cancelScheduledNotificationAsync(n.identifier)
  ));
}

/**
 * Get set of event IDs that have active reminders.
 */
export async function getScheduledEventIds() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return new Set(
      scheduled
        .filter(n => n.identifier.startsWith(NOTIF_ID_PREFIX))
        .map(n => Number(n.identifier.replace(NOTIF_ID_PREFIX, '')))
    );
  } catch (_) {
    return new Set();
  }
}
