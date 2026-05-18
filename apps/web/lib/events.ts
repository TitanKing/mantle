/** Re-export from the shared workspace package. See @mantle/content. */
export {
  EVENTS_ROOT_LABEL,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  listDueReminders,
  markReminderSent,
  ownersWithEvents,
  type EventRow,
  type CreateEventInput,
  type UpdateEventInput,
} from '@mantle/content/events';
