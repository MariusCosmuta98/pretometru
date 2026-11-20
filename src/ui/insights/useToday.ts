import { useEffect, useState } from 'react';
import { todayKey } from '@/domain';

const CHECK_EVERY_MS = 60_000;

/**
 * The calendar day in Europe/Bucharest, read again when the app comes back to the foreground and once
 * a minute while it is open. The dashboard screens show "this month" and "the last N months", and an
 * installed app can stay open for days: use the day as the `key` of the screen so that a new day starts
 * it over with a fresh clock.
 */
export function useToday(): string {
  const [day, setDay] = useState(() => todayKey(new Date()));

  useEffect(() => {
    const refresh = () => {
      setDay(todayKey(new Date()));
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, []);

  return day;
}
