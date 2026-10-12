/**
 * Normalization logic for wine data.
 * Standardizes bottle sizes, vintages, and other wine-specific fields.
 *
 * These functions are all called from App.tsx's processData() (the row-by-row cleanup pass that runs after
 * the SchemaMapper mapping is applied and before validation), and normalizeDate() is also used directly by
 * DateInput.tsx to normalize what the user types in the row editor.
 */

/**
 * Standardizes bottle sizes to Centiliters (CL).
 * Examples:
 * 750ml, 750, 0.75, 0.75L, 75cl -> 75
 * 1.5L, 150cl, 1500 -> 150
 * 375ml -> 37.5
 * Magnum -> 150
 */
export function normalizeBottleSize(rawSize: string | number): number | null {
  if (rawSize === undefined || rawSize === null || rawSize === '') return null;
  
  // Remove commas and whitespace
  const cleanStr = String(rawSize).replace(/,/g, '').toLowerCase().trim();
  
  // Handle named sizes
  const namedSizes: Record<string, number> = {
    'standard': 75,
    'bottle': 75,
    'bt': 75,
    'half': 37.5,
    'demi': 37.5,
    'quarter': 18.75,
    'split': 18.75,
    'piccolo': 18.75,
    'magnum': 150,
    'mg': 150,
    'double magnum': 300,
    'dm': 300,
    'jeroboam': 300, // Standardizing to 300cl (Double Magnum equivalent) for simplicity, though can vary
    'rehoboam': 450,
    'imperial': 600,
    'methuselah': 600,
    'salmanazar': 900,
    'balthazar': 1200,
    'nebuchadnezzar': 1500,
    'melchior': 1800,
    'solomon': 2000,
    'sovereign': 2500,
    'primat': 2700,
    'melchizedek': 3000,
    'jennie': 50,
    'clavelin': 62
  };

  // Check for exact match or partial match in named sizes
  for (const [name, size] of Object.entries(namedSizes)) {
    if (cleanStr === name || cleanStr === name + 's') return size;
  }

  // Extract numeric part and unit
  const numericMatch = cleanStr.match(/(\d+(\.\d+)?)/);
  if (!numericMatch) return null;

  const val = parseFloat(numericMatch[1]);
  const unit = cleanStr.replace(numericMatch[0], '').trim();

  // Heuristic-based normalization to Centiliters (CL)
  // 1. If unit is explicit
  if (unit === 'ml' || unit === 'milliliters' || unit === 'm') return val / 10;
  if (unit === 'l' || unit === 'liter' || unit === 'liters') return val * 100;
  if (unit === 'cl' || unit === 'centiliters' || unit === 'c') return val;

  // 2. If no unit was given, guess from the magnitude of the number alone, based on what real bottle
  // sizes look like in each unit:
  // If value is very small (e.g., 0.75, 1.5, 4.5, 9), it's almost certainly Liters
  if (val < 20) return val * 100;

  // If value is large (e.g., 375, 750, 1500, 9000), it's almost certainly Milliliters
  if (val >= 100) return val / 10;

  // If it's in the middle (e.g., 37.5, 75), assume it's already Centiliters — this is the range where a
  // "no unit" number is most likely to already be expressed in cl (the standard 75cl bottle sits right here).
  return val;
}

/**
 * Standardizes vintages.
 * Examples:
 * "NV", "Non-Vintage", "N.V." -> "NV"
 * "98" -> "1998"
 * "2021" -> "2021"
 */
export function normalizeVintage(rawVintage: string | number): string {
  if (rawVintage === undefined || rawVintage === null || rawVintage === '') return '';
  
  const str = String(rawVintage).toUpperCase().trim();
  
  if (['NV', 'NON-VINTAGE', 'N.V.', 'NON VINTAGE'].includes(str)) {
    return 'NV';
  }
  
  const numericMatch = str.match(/\d+/);
  if (!numericMatch) return 'NV';
  
  let year = parseInt(numericMatch[0]);

  if (year < 100) {
    // Simple 2-digit logic: 00-26 -> 2000s, 27-99 -> 1900s.
    // 26 is used as the pivot because this cutoff is meant to track "not more than a couple years in the
    // future" relative to when this code was written — 2-digit years shouldn't resolve to a year that
    // hasn't happened yet, since wine vintages are always in the past or very-near future.
    if (year <= 26) {
      year = 2000 + year;
    } else {
      year = 1900 + year;
    }
  }
  
  const currentYear = new Date().getFullYear();
  if (year >= 1900 && year <= currentYear) {
    return String(year);
  }
  
  return 'INVALID';
}

/**
 * Parses a raw price string/number into a numeric value plus a detected 3-letter currency code.
 * Defaults to GBP when no currency symbol is present, since that's this app's primary market.
 */
export function normalizeCurrency(rawPrice: string | number): { value: number | null, currency: string } {
  if (rawPrice === undefined || rawPrice === null || rawPrice === '') return { value: null, currency: 'GBP' };
  
  const str = String(rawPrice).replace(/,/g, '').trim();
  let currency = 'GBP';
  
  if (str.includes('$')) currency = 'USD';
  else if (str.includes('€')) currency = 'EUR';
  else if (str.includes('£')) currency = 'GBP';
  
  const numericMatch = str.match(/(\d+(\.\d+)?)/);
  const value = numericMatch ? parseFloat(numericMatch[1]) : null;
  
  return { value, currency };
}

// Lowercase alias -> canonical country name. Only covers the aliases actually seen in imported data so far
// (abbreviations, alternate names); anything not listed here is passed through unchanged by normalizeCountry.
const COUNTRY_ALIASES: Record<string, string> = {
  'uk': 'United Kingdom',
  'gb': 'United Kingdom',
  'great britain': 'United Kingdom',
  'britain': 'United Kingdom',
  'england': 'United Kingdom',
  'us': 'USA',
  'united states': 'USA',
  'united states of america': 'USA',
  'u.s.a.': 'USA',
  'u.s.': 'USA',
  'nz': 'New Zealand',
  'sa': 'South Africa',
  'rsa': 'South Africa',
};

// Maps a country name/abbreviation to its canonical form via COUNTRY_ALIASES; unrecognized input is
// returned trimmed but otherwise as-is. Called from App.tsx's processData() before country/region validation,
// so region lookups match against the canonical name rather than whatever abbreviation was in the source file.
export function normalizeCountry(raw: string): string {
  if (!raw) return raw;
  const key = raw.trim().toLowerCase();
  return COUNTRY_ALIASES[key] ?? raw.trim();
}

// Checks a day/month/year combination is a real calendar date (correct month range, and day within that
// month's actual length — e.g. rejects 30 Feb).
function isValidDate(d: number, m: number, y: number): boolean {
  if (m < 1 || m > 12) return false;
  if (y < 1900 || y > 2100) return false;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) return false;
  return true;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// Expands a 2-digit year to 4 digits, using the same "near future rolls back a century" pivot idea as
// normalizeVintage (here fixed at 29 rather than derived from the current year).
function expandYear(y: number): number {
  if (y < 100) return y <= 29 ? 2000 + y : 1900 + y;
  return y;
}

// Formats day/month/year as the app's canonical dd/mm/yyyy display string.
function fmtDate(d: number, m: number, y: number): string {
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

// Recognized month names/abbreviations (lowercased) for the textual-date branch of normalizeDate() below.
const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Standardizes dates to dd/mm/yyyy.
 * Accepts a wide range of common formats:
 *   1/2/25  •  1-2-2025  •  01.02.2025  •  2025-02-01
 *   "2 Jan 2025"  •  "Jan 2, 2025"  •  "January 2 2025"
 *   Excel serial numbers
 */
export function normalizeDate(rawDate: string | number): string | null {
  if (rawDate === undefined || rawDate === null || rawDate === '') return null;

  const str = String(rawDate).trim();

  // Tries several parsing strategies in order, from most to least specific, returning the first one that
  // yields a valid calendar date. Falls through to null (unrecognized) only if none of them match.

  // 1. Numeric separated: d[sep]m[sep]y — handles /, -, . and 2- or 4-digit year
  const numMatch = str.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/);
  if (numMatch) {
    const p1 = parseInt(numMatch[1], 10);
    const p2 = parseInt(numMatch[2], 10);
    const p3 = parseInt(numMatch[3], 10);

    if (numMatch[1].length === 4 || p1 > 31) {
      // First segment is a 4-digit year, or too large to be a day/month -> yyyy-mm-dd (ISO-style)
      const y = expandYear(p1), m = p2, d = p3;
      if (isValidDate(d, m, y)) return fmtDate(d, m, y);
    } else {
      // Otherwise assume dd/mm/yy or dd/mm/yyyy — the EU/UK day-first convention this app defaults to,
      // rather than the US month-first convention (there's no way to tell "1/2/2025" apart otherwise).
      const d = p1, m = p2, y = expandYear(p3);
      if (isValidDate(d, m, y)) return fmtDate(d, m, y);
    }
    return null;
  }

  // 2. Textual month: "2 Jan 2025", "Jan 2, 2025", "2 January 2025", "January 2, 2025"
  const textMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)[,\s]+(\d{2,4})$/) ||
                    str.match(/^([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{2,4})$/);
  if (textMatch) {
    let d: number, m: number, y: number;
    const isMonthFirst = isNaN(parseInt(textMatch[1], 10));
    if (isMonthFirst) {
      m = MONTH_ABBR[textMatch[1].toLowerCase()] ?? 0;
      d = parseInt(textMatch[2], 10);
      y = expandYear(parseInt(textMatch[3], 10));
    } else {
      d = parseInt(textMatch[1], 10);
      m = MONTH_ABBR[textMatch[2].toLowerCase()] ?? 0;
      y = expandYear(parseInt(textMatch[3], 10));
    }
    if (isValidDate(d, m, y)) return fmtDate(d, m, y);
    return null;
  }

  // 3. Excel serial number — spreadsheets often store dates as "days since 1899-12-30" and this can survive
  // into a pasted/exported CSV as a bare number. The 20000-100000 range roughly covers dates from 1954 to
  // 2173, which is generous enough to catch real data while avoiding treating small plain numbers as dates.
  const serial = parseFloat(str);
  if (!isNaN(serial) && serial > 20000 && serial < 100000 && !/[-./]/.test(str)) {
    const date = new Date(1899, 11, 30 + Math.floor(serial));
    const d = date.getDate(), m = date.getMonth() + 1, y = date.getFullYear();
    if (isValidDate(d, m, y)) return fmtDate(d, m, y);
  }

  // 4. Last resort: let the JS Date constructor have a go (handles ISO strings, "Mon Feb 01 2025", etc.)
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const d = parsed.getDate(), m = parsed.getMonth() + 1, y = parsed.getFullYear();
    if (isValidDate(d, m, y)) return fmtDate(d, m, y);
  }

  return null;
}
