import React, { useState } from 'react';
import { X, Check, Trash2, AlertCircle, Edit2 } from 'lucide-react';
import { motion } from 'motion/react';

interface DuplicateComparisonModalProps {
  row1: any;
  row2: any;
  fields: { key: string, label: string }[];
  onKeep: (id: number) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
  onEdit?: (rowId: number, fieldKey: string, newValue: string) => void;
  type?: 'duplicate' | 'price';
  queueInfo?: { remaining: number };
}

export const DuplicateComparisonModal: React.FC<DuplicateComparisonModalProps> = ({
  row1,
  row2,
  fields,
  onKeep,
  onRemove,
  onClose,
  onEdit,
  type = 'duplicate',
  queueInfo,
}) => {
  const isPrice = type === 'price';
  const inQueue = !!queueInfo;
  const [editingCell, setEditingCell] = useState<{ rowId: number; fieldKey: string; value: string } | null>(null);

  const startEdit = (rowId: number, fieldKey: string, currentValue: any) => {
    if (!onEdit) return;
    setEditingCell({ rowId, fieldKey, value: currentValue === undefined || currentValue === null ? '' : String(currentValue) });
  };

  const commitEdit = () => {
    if (!editingCell || !onEdit) return;
    onEdit(editingCell.rowId, editingCell.fieldKey, editingCell.value);
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingCell(null);
  };

  const renderCell = (row: any, fieldKey: string, isDifferent: boolean, isPriceField: boolean) => {
    const rawVal = row[fieldKey];
    const isCurrentlyEditing = editingCell?.rowId === row.id && editingCell?.fieldKey === fieldKey;

    const bgClass = isDifferent
      ? (isPrice && isPriceField ? 'bg-indigo-50/30' : 'bg-amber-50/30')
      : '';
    const fontClass = isDifferent
      ? (isPrice && isPriceField ? 'font-bold' : 'font-medium')
      : '';

    if (isCurrentlyEditing) {
      return (
        <div className={`py-2 px-4 text-sm border-b border-black/5 ${bgClass}`}>
          <input
            autoFocus
            className="w-full px-2 py-1 text-sm border border-black/20 rounded outline-none focus:border-black/50 bg-white"
            value={editingCell.value}
            onChange={e => setEditingCell(prev => prev ? { ...prev, value: e.target.value } : null)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
          />
        </div>
      );
    }

    return (
      <div
        className={`group py-3 px-4 text-sm border-b border-black/5 ${bgClass} ${fontClass} ${onEdit ? 'cursor-pointer hover:bg-black/[0.02]' : ''} flex items-center justify-between gap-2`}
        onClick={() => startEdit(row.id, fieldKey, rawVal)}
        title={onEdit ? 'Click to edit' : undefined}
      >
        <span>
          {rawVal === undefined || rawVal === null || rawVal === ''
            ? <span className="text-black/20 italic">Empty</span>
            : String(rawVal)}
        </span>
        {onEdit && (
          <Edit2 size={11} className="text-black/25 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[32px] shadow-2xl border border-black/5 w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className={`p-8 border-b border-black/5 flex justify-between items-center ${isPrice ? 'bg-indigo-50/30' : 'bg-amber-50/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isPrice ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}>
              <AlertCircle size={24} />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-2xl font-serif font-medium">{isPrice ? 'Compare Prices' : 'Compare Duplicates'}</h2>
                {inQueue && (
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${isPrice ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-700'}`}>
                    {queueInfo.remaining} remaining
                  </span>
                )}
              </div>
              <p className="text-sm text-black/40">
                {isPrice
                  ? 'Review this row against a reference entry to verify the price discrepancy. Click any value to edit it.'
                  : 'Review these rows side-by-side to decide which one to keep. Click any value to edit it.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-black/5 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="overflow-auto flex-1 p-8">
          <div className="grid grid-cols-[200px_1fr_1fr] gap-4">
            {/* Header Row */}
            <div className="sticky top-0 bg-white z-10 py-4 border-b border-black/5 font-bold text-[10px] uppercase tracking-widest text-black/30">Field</div>
            <div className="sticky top-0 bg-white z-10 py-4 border-b border-black/5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">Row {row1.id + 1} {isPrice ? '(Reference)' : '(Original)'}</span>
                {!isPrice && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onKeep(row1.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-600 transition-all shadow-sm"
                    >
                      <Check size={12} />
                      Keep This
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="sticky top-0 bg-white z-10 py-4 border-b border-black/5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">Row {row2.id + 1} {isPrice ? '(Outlier)' : '(Duplicate)'}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => onKeep(row2.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-600 transition-all shadow-sm"
                  >
                    <Check size={12} />
                    {isPrice ? 'Keep Price' : 'Keep This'}
                  </button>
                  {!isPrice && (
                    <button
                      onClick={() => onRemove(row2.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-rose-600 transition-all shadow-sm"
                    >
                      <Trash2 size={12} />
                      Remove This
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Field Rows */}
            {fields.map(field => {
              const val1 = row1[field.key];
              const val2 = row2[field.key];
              const isDifferent = String(val1) !== String(val2);
              const isPriceField = field.key === 'exc_vat_case' || field.key === 'case_cost_price';

              return (
                <React.Fragment key={field.key}>
                  <div className={`py-3 px-2 text-xs font-medium border-b border-black/5 flex items-center ${isDifferent ? (isPrice && isPriceField ? 'bg-indigo-50/50 text-indigo-700' : 'bg-amber-50/50 text-amber-700') : 'text-black/60'}`}>
                    {field.label}
                  </div>
                  {renderCell(row1, field.key, isDifferent, isPriceField)}
                  {renderCell(row2, field.key, isDifferent, isPriceField)}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="p-8 bg-black/[0.02] border-t border-black/5 flex justify-end gap-4">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-full text-sm font-medium text-black/40 hover:text-black transition-colors"
          >
            {inQueue ? 'End Review' : 'Close'}
          </button>
          {!isPrice ? (
            <>
              <button
                onClick={() => {
                  onRemove(row2.id);
                  onClose();
                }}
                className="px-8 py-2.5 bg-rose-600 text-white rounded-full text-sm font-medium hover:scale-105 active:scale-95 transition-all shadow-lg"
              >
                Remove Duplicate Row
              </button>
              <button
                onClick={() => {
                  onKeep(row2.id);
                  onClose();
                }}
                className="px-8 py-2.5 bg-black text-white rounded-full text-sm font-medium hover:scale-105 active:scale-95 transition-all shadow-lg"
              >
                Keep Both Rows
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                onKeep(row2.id);
                onClose();
              }}
              className="px-8 py-2.5 bg-black text-white rounded-full text-sm font-medium hover:scale-105 active:scale-95 transition-all shadow-lg"
            >
              Keep Price
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};
