import type { DateTime } from "luxon";
import type { RRule } from "rrule";

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start: DateTime;
  end: DateTime;
  allDay?: boolean;
  rrule?: RRule;
}
