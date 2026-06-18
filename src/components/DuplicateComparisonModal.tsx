import React from 'react';
import { X, Check, Trash2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

interface DuplicateComparisonModalProps {
  row1: any;
  row2: any;
  fields: { key: string, label: string }[];
  onKeep: (id: number) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
  type?: 'duplicate' | 'price';
}

export const DuplicateComparisonModal: React.FC<DuplicateComparisonModalProps> = ({ 
  row1, 
  row2, 
  fields, 
  onKeep, 
  onRemove, 
  onClose,
  type = 'duplicate'
}) => {
  const isPrice = type === 'price';
  
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
              <h2 className="text-2xl font-serif font-medium">{isPrice ? 'Compare Prices' : 'Compare Duplicates'}</h2>
              <p className="text-sm text-black/40">
                {isPrice 
                  ? 'Review this row against a reference entry to verify the price discrepancy.' 
                  : 'Review these rows side-by-side to decide which one to keep.'}
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
                  <div className={`py-3 px-4 text-sm border-b border-black/5 ${isDifferent ? (isPrice && isPriceField ? 'bg-indigo-50/30 font-bold' : 'bg-amber-50/30 font-medium') : ''}`}>
                    {val1 === undefined || val1 === null || val1 === '' ? <span className="text-black/20 italic">Empty</span> : String(val1)}
                  </div>
                  <div className={`py-3 px-4 text-sm border-b border-black/5 ${isDifferent ? (isPrice && isPriceField ? 'bg-indigo-50/30 font-bold' : 'bg-amber-50/30 font-medium') : ''}`}>
                    {val2 === undefined || val2 === null || val2 === '' ? <span className="text-black/20 italic">Empty</span> : String(val2)}
                  </div>
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
            Close
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
