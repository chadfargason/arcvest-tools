/**
 * Portfolio X-Ray - Date Utilities
 *
 * Centralized date handling for consistent date operations.
 */

/**
 * Parse a date string (YYYY-MM-DD) to a Date object in UTC.
 */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

/**
 * Format a Date object to YYYY-MM-DD string.
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get the last day of the month for a given date.
 */
export function getMonthEnd(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  // Day 0 of next month = last day of current month
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

/**
 * Get the last complete month-end (the most recent month-end before today).
 */
export function getLastCompleteMonthEnd(): Date {
  const today = new Date();
  // Go back to previous month to ensure we have complete data
  return getMonthEnd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
}

/**
 * Generate an array of month-end dates between start and end (inclusive).
 */
export function getMonthEnds(startDate: Date, endDate: Date): Date[] {
  const monthEnds: Date[] = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    const monthEnd = getMonthEnd(current);
    if (monthEnd >= startDate && monthEnd <= endDate) {
      monthEnds.push(monthEnd);
    }
    // Move to first day of next month
    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  }

  return monthEnds;
}

/**
 * Calculate the number of years between two dates (fractional).
 */
export function yearsBetween(startDate: Date, endDate: Date): number {
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return (endDate.getTime() - startDate.getTime()) / msPerYear;
}

/**
 * Calculate the number of months between two dates (approximate).
 */
export function monthsBetween(startDate: Date, endDate: Date): number {
  const years = (endDate.getFullYear() - startDate.getFullYear());
  const months = (endDate.getMonth() - startDate.getMonth());
  return years * 12 + months;
}

/**
 * Format date as MM-DD-YYYY (for display).
 */
export function formatDateDisplay(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}-${parts[2]}-${parts[0]}`;
}

/**
 * Check if a date string is within a range (inclusive).
 */
export function isDateInRange(dateStr: string, startStr: string, endStr: string): boolean {
  return dateStr >= startStr && dateStr <= endStr;
}

/**
 * Get the month-end date string for a given date string.
 */
export function getMonthEndStr(dateStr: string): string {
  return formatDate(getMonthEnd(parseDate(dateStr)));
}
