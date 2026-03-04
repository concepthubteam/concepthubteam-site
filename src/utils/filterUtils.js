function toLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateISOs() {
  const now = new Date();
  const today = toLocalISO(now);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowISO = toLocalISO(tomorrow);

  const dayOfWeek = now.getDay();
  const daysUntilSat = dayOfWeek === 6 ? 0 : (6 - dayOfWeek);
  const sat = new Date(now);
  sat.setDate(now.getDate() + daysUntilSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  const satISO = toLocalISO(sat);
  const sunISO = toLocalISO(sun);

  const weekISOs = [];
  for (let i = 0; i <= daysUntilSat + 1; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    weekISOs.push(toLocalISO(d));
  }

  return { today, tomorrowISO, satISO, sunISO, weekISOs };
}

export function matchesFilter(event, filter) {
  if (!event.dateISO) return true;
  const { today, tomorrowISO, satISO, sunISO, weekISOs } = getDateISOs();
  if (filter === 'today')    return event.dateISO === today;
  if (filter === 'tomorrow') return event.dateISO === tomorrowISO;
  if (filter === 'weekend')  return event.dateISO === satISO || event.dateISO === sunISO;
  if (filter === 'week')     return weekISOs.includes(event.dateISO);
  return true;
}
