/** Dates from the bridge. A bare 'YYYY-MM-DD' is a calendar day: `new Date()` would read it as
 *  UTC midnight and show the day before anywhere west of Greenwich. */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s)
}

export const shortDate = (s: string) => parseDate(s).toLocaleDateString()
