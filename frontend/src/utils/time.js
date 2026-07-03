export function formatTimestamp(iso, timezone = 'UTC') {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: timezone,
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function formatFeedTimestamp(iso, timezone = 'UTC') {
  try {
    const d = new Date(iso);
    const tzAbbr = getTimezoneAbbr(timezone);

    const ymd = (date) => new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);

    const today = ymd(new Date());
    const yesterday = ymd(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const target = ymd(d);

    if (target === today) {
      const hm = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
      return `${hm} (${tzAbbr})`;
    }
    if (target === yesterday) {
      return `YESTERDAY (${tzAbbr})`;
    }
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const mm = parts.find(p => p.type === 'month')?.value ?? '';
    const dd = parts.find(p => p.type === 'day')?.value ?? '';
    return `${mm}/${dd} (${tzAbbr})`;
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function getTimezoneAbbr(timezone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? timezone;
  } catch {
    return timezone;
  }
}
