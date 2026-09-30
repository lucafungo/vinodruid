import React, { useState } from 'react';
import { Plus, Trash2, ArrowRight } from 'lucide-react';

interface Field {
  key: string;
  label: string;
  required: boolean;
  options?: string[];
  hint?: string;
}

// fields is the schema's field list for the current data type (App.tsx passes the subset the user picked in
// the column picker, via pickerSelectedKeys). onSubmit receives the non-empty rows the user entered — App.tsx's
// handleManualSubmit runs them through the same validation pipeline as an uploaded file. onCancel returns to
// the home/upload step (App.tsx's goHome).
interface ManualEntryGridProps {
  fields: Field[];
  onSubmit: (rows: Record<string, string>[]) => void;
  onCancel: () => void;
}

// Builds one blank row object with every field key present but empty.
const makeEmptyRow = (fields: Field[]): Record<string, string> =>
  Object.fromEntries(fields.map(f => [f.key, '']));

// Spreadsheet-like grid for typing (or pasting) rows of data by hand, as an alternative to uploading a file —
// rendered by App.tsx during the 'manual' step ("start from empty" flow). Starts with 5 blank rows and lets
// the user add/delete rows and paste tab/newline-separated data from Excel-like sources.
export function ManualEntryGrid({ fields, onSubmit, onCancel }: ManualEntryGridProps) {
  const [rows, setRows] = useState<Record<string, string>[]>(() =>
    Array.from({ length: 5 }, () => makeEmptyRow(fields))
  );

  const updateCell = (rowIdx: number, key: string, value: string) => {
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: value } : r));
  };

  // Handles pasting a block of cells copied from Excel/Sheets (or similar) into one cell of the grid.
  // Excel-style clipboard data is tab-separated within a row and newline-separated between rows, so we
  // split on those to reconstruct a 2D block, then paste it starting at the cell that was focused
  // (rowIdx/colIdx), growing the grid with extra blank rows if the pasted block runs past the current end.
  // A true single-cell paste (no tabs/newlines) is left alone so the browser's default paste behavior applies.
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement | HTMLSelectElement>, rowIdx: number, colIdx: number) => {
    const text = e.clipboardData.getData('text');
    const pastedRows = text.split('\n').map(r => r.split('\t'));
    if (pastedRows.length === 1 && pastedRows[0].length === 1) return; // single cell — let browser handle it
    e.preventDefault();
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      pastedRows.forEach((pastedCols, ri) => {
        const targetRow = rowIdx + ri;
        // Extend the grid if needed
        while (next.length <= targetRow) next.push(makeEmptyRow(fields));
        pastedCols.forEach((val, ci) => {
          const targetCol = colIdx + ci;
          // Silently drop any pasted columns that run past the last field — grid only has fields.length columns.
          if (targetCol < fields.length) {
            next[targetRow][fields[targetCol].key] = val.trim();
          }
        });
      });
      return next;
    });
  };

  const addRow = () => setRows(prev => [...prev, makeEmptyRow(fields)]);

  // Deleting is disabled once only one row is left — the grid always keeps at least one row to edit.
  const deleteRow = (idx: number) => {
    if (rows.length === 1) return;
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  // Drops fully-blank rows (e.g. unused rows from the initial 5) before submitting, then hands the rest to onSubmit.
  const handleSubmit = () => {
    const nonEmpty = rows.filter(r => fields.some(f => (r[f.key] || '').trim() !== ''));
    if (nonEmpty.length === 0) return;
    onSubmit(nonEmpty);
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white shadow-sm">
        <table className="text-sm border-collapse min-w-full">
          <thead>
            <tr className="border-b border-black/10 bg-black/[0.02]">
              <th className="w-8 px-3 py-3 text-center text-black/30 font-medium text-xs">#</th>
              {fields.map(f => (
                <th key={f.key} className="px-3 py-3 text-left font-medium text-black/60 whitespace-nowrap text-xs uppercase tracking-wider">
                  {f.label}
                  {f.required && <span className="text-rose-500 ml-0.5">*</span>}
                </th>
              ))}
              <th className="w-8 px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-black/5 hover:bg-black/[0.01] group">
                <td className="px-3 py-2 text-center text-black/30 text-xs">{rowIdx + 1}</td>
                {fields.map((f, colIdx) => (
                  <td key={f.key} className="px-1.5 py-1.5">
                    {f.options ? (
                      <select
                        value={row[f.key]}
                        onChange={e => updateCell(rowIdx, f.key, e.target.value)}
                        onPaste={e => handlePaste(e, rowIdx, colIdx)}
                        className="w-full min-w-[120px] px-2 py-1.5 text-sm border border-black/10 rounded-lg bg-white focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
                      >
                        <option value="" />
                        {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={row[f.key]}
                        onChange={e => updateCell(rowIdx, f.key, e.target.value)}
                        onPaste={e => handlePaste(e, rowIdx, colIdx)}
                        placeholder={f.hint || ''}
                        className="w-full min-w-[100px] px-2 py-1.5 text-sm border border-black/10 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={() => deleteRow(rowIdx)}
                    disabled={rows.length === 1}
                    className="p-1 rounded-md hover:bg-rose-50 hover:text-rose-500 text-black/0 group-hover:text-black/20 transition-colors disabled:!text-black/0"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={addRow}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-black/60 hover:text-black border border-black/10 rounded-xl hover:border-black/20 bg-white transition-colors"
        >
          <Plus size={14} />
          Add Row
        </button>
        <div className="flex gap-3 items-center">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-black/40 hover:text-black transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-xl hover:bg-black/80 transition-colors"
          >
            Validate & Review
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
