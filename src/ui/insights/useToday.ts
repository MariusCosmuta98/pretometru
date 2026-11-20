import { useEffect, useState } from 'react';
import { todayKey } from '@/domain';

/**
 * The calendar day in Europe/Bucharest, read again whenever the app comes back to the foreground. The
 * dashboard screens show "this month" and "the last N months", and an installed app can stay open for
 * days: use the day as the `key` of the screen so that a new day starts it over with a fresh clock.
 */
export function useToday(): string {
  const [day, setDay] = useState(() => todayKey(new Date()));

  useEffect(() => {
    const refresh = () => {
      setDay(todayKey(new Date()));
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return day;
}
