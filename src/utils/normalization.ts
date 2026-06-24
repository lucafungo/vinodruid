/**
 * Normalization logic for wine data.
 * Standardizes bottle sizes, vintages, and other wine-specific fields.
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

  // 2. If no unit, use heuristics
  // If value is very small (e.g., 0.75, 1.5, 4.5, 9), it's almost certainly Liters
  if (val < 20) return val * 100;
  
  // If value is large (e.g., 375, 750, 1500, 9000), it's almost certainly Milliliters
  if (val >= 100) return val / 10;
  
  // If it's in the middle (e.g., 37.5, 75), assume it's already Centiliters
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
    // Simple 2-digit logic: 00-26 -> 2000s, 27-99 -> 1900s
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
 * Standardizes currency symbols.
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

function expandYear(y: number): number {
  if (y < 100) return y <= 29 ? 2000 + y : 1900 + y;
  return y;
}

function fmtDate(d: number, m: number, y: number): string {
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

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

  // 1. Numeric separated: d[sep]m[sep]y — handles /, -, . and 2- or 4-digit year
  const numMatch = str.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/);
  if (numMatch) {
    const p1 = parseInt(numMatch[1], 10);
    const p2 = parseInt(numMatch[2], 10);
    const p3 = parseInt(numMatch[3], 10);

    if (numMatch[1].length === 4 || p1 > 31) {
      // yyyy-mm-dd
      const y = expandYear(p1), m = p2, d = p3;
      if (isValidDate(d, m, y)) return fmtDate(d, m, y);
    } else {
      // dd/mm/yy or dd/mm/yyyy (EU default)
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

  // 3. Excel serial number
  const serial = parseFloat(str);
  if (!isNaN(serial) && serial > 20000 && serial < 100000 && !/[-./]/.test(str)) {
    const date = new Date(1899, 11, 30 + Math.floor(serial));
    const d = date.getDate(), m = date.getMonth() + 1, y = date.getFullYear();
    if (isValidDate(d, m, y)) return fmtDate(d, m, y);
  }

  // 4. JS Date fallback (handles ISO strings, "Mon Feb 01 2025", etc.)
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const d = parsed.getDate(), m = parsed.getMonth() + 1, y = parsed.getFullYear();
    if (isValidDate(d, m, y)) return fmtDate(d, m, y);
  }

  return null;
}
