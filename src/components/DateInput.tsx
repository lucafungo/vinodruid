import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { normalizeDate } from '../utils/normalization';

// value/onChange work like a normal controlled text input — value is expected/produced in dd/mm/yyyy display
// format. Used by RowEditor.tsx for any field that looks like a date (see isDateField there).
interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// Parses a dd/mm/yyyy display string back into a Date, returning null if it isn't in that exact format
// or isn't a real calendar date (e.g. 31/02/2025).
function parseDisplay(str: string): Date | null {
  if (!str) return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1]), mo = parseInt(m[2]) - 1, y = parseInt(m[3]);
  const date = new Date(y, mo, d);
  return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d ? date : null;
}

// Formats a Date back into the dd/mm/yyyy display string.
function toDisplay(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

// Free-text date field with a calendar picker button. Typed text is normalized to dd/mm/yyyy on blur using
// normalizeDate() from utils/normalization.ts, so users can type loosely-formatted dates and still get a
// consistent value back through onChange.
export const DateInput: React.FC<DateInputProps> = ({ value, onChange, placeholder, className }) => {
  const [text, setText] = useState(value || '');
  const [showPicker, setShowPicker] = useState(false);
  const [calYear, setCalYear] = useState(() => {
    const d = parseDisplay(value); return d ? d.getFullYear() : new Date().getFullYear();
  });
  const [calMonth, setCalMonth] = useState(() => {
    const d = parseDisplay(value); return d ? d.getMonth() : new Date().getMonth();
  });
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setText(value || ''); }, [value]);

  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  // On blur, run whatever the user typed through normalizeDate() and, if it's parseable, replace the
  // text with the standardized dd/mm/yyyy form and propagate it via onChange. Unparseable text is left
  // as-is (see isInvalid below) so the user can see and fix their input rather than losing it silently.
  const handleBlur = () => {
    if (!text.trim()) { onChange(''); return; }
    const normalized = normalizeDate(text);
    if (normalized) { setText(normalized); onChange(normalized); }
  };

  // Opens/toggles the calendar dropdown, seeding it to the currently-entered date (or today if none/invalid).
  const openPicker = () => {
    const parsed = parseDisplay(text) ?? new Date();
    setCalYear(parsed.getFullYear());
    setCalMonth(parsed.getMonth());
    setShowPicker(v => !v);
  };

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  // User clicked a day in the calendar grid — format it and commit immediately (no blur needed).
  const selectDay = (day: number) => {
    const date = new Date(calYear, calMonth, day);
    const formatted = toDisplay(date);
    setText(formatted);
    onChange(formatted);
    setShowPicker(false);
  };

  // Calendar grid: Monday-first
  const firstDayOfMonth = new Date(calYear, calMonth, 1).getDay();
  const offset = (firstDayOfMonth + 6) % 7; // 0=Mon
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const selected = parseDisplay(text);

  // Live preview while typing (only show when text isn't already normalized).
  // preview shows what normalizeDate() would turn the text into; isInvalid flags text that
  // normalizeDate() can't parse at all, so the user gets feedback before they even blur the field.
  const isAlreadyNormalized = /^\d{2}\/\d{2}\/\d{4}$/.test(text);
  const preview = text && !isAlreadyNormalized ? normalizeDate(text) : null;
  const isInvalid = text && !isAlreadyNormalized && !preview;

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex gap-1 items-stretch">
        <div className="relative flex-1">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={handleBlur}
            placeholder={placeholder ?? 'dd/mm/yyyy'}
            className={`${className ?? ''} ${isInvalid ? '!border-amber-300 !bg-amber-50/40' : ''}`}
          />
          {preview && (
            <span className="absolute -bottom-[14px] left-1 text-[9px] text-emerald-600 font-medium whitespace-nowrap">
              → {preview}
            </span>
          )}
          {isInvalid && (
            <span className="absolute -bottom-[14px] left-1 text-[9px] text-amber-500 font-medium whitespace-nowrap">
              unrecognized format
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={openPicker}
          className={`px-2.5 rounded-xl border transition-colors flex-shrink-0 flex items-center ${
            showPicker
              ? 'bg-black text-white border-black'
              : 'border-black/10 bg-black/[0.03] hover:bg-black/[0.08] text-black/50 hover:text-black'
          }`}
        >
          <Calendar size={13} />
        </button>
      </div>

      {showPicker && (
        <div className="absolute top-full left-0 mt-1.5 z-[100] bg-white rounded-2xl shadow-2xl border border-black/10 p-3 w-60">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2 px-0.5">
            <button type="button" onClick={prevMonth}
              className="p-1 hover:bg-black/5 rounded-lg transition-colors text-black/50 hover:text-black">
              <ChevronLeft size={13} />
            </button>
            <span className="text-[11px] font-bold">{MONTHS[calMonth]} {calYear}</span>
            <button type="button" onClick={nextMonth}
              className="p-1 hover:bg-black/5 rounded-lg transition-colors text-black/50 hover:text-black">
              <ChevronRight size={13} />
            </button>
          </div>

          {/* Day names */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[8px] font-bold text-black/25 py-0.5">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const isSel = selected &&
                selected.getDate() === day &&
                selected.getMonth() === calMonth &&
                selected.getFullYear() === calYear;
              const isToday =
                today.getDate() === day &&
                today.getMonth() === calMonth &&
                today.getFullYear() === calYear;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`text-[11px] py-[3px] rounded-lg transition-colors ${
                    isSel
                      ? 'bg-black text-white font-bold'
                      : isToday
                      ? 'bg-black/10 font-bold text-black'
                      : 'hover:bg-black/5 text-black/70'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Quick nav: today */}
          <div className="mt-2 pt-2 border-t border-black/5">
            <button
              type="button"
              onClick={() => {
                const t = new Date();
                setCalYear(t.getFullYear());
                setCalMonth(t.getMonth());
                selectDay(t.getDate());
              }}
              className="w-full text-[9px] font-bold uppercase tracking-wider text-black/30 hover:text-black hover:bg-black/5 rounded-lg py-1 transition-colors"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
