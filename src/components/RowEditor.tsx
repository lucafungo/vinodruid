import React, { useState } from 'react';
import { X, Save, AlertCircle, Table, Trash2, Copy } from 'lucide-react';
import { motion } from 'motion/react';
import { DateInput } from './DateInput';

interface RowEditorProps {
  row: any;
  originalRow?: any;
  fields: { key: string, label: string, required: boolean }[];
  onSave: (updatedRow: any) => void;
  onDelete?: (id: number) => void;
  onClose: () => void;
}

export const RowEditor: React.FC<RowEditorProps> = ({ row, originalRow, fields, onSave, onDelete, onClose }) => {
  const [formData, setFormData] = useState({ ...row });

  const handleChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const DATE_KEYS = new Set([
    'acquired_on', 'landed_on', 'order_date', 'delivery_date', 'invoice_date',
    'booking_date', 'settlement_date', 'dispatch_date',
  ]);
  const isDateField = (key: string) =>
    DATE_KEYS.has(key) || key.endsWith('_date') || key.endsWith('_on') || key.startsWith('date_');

  const baseInputCls = 'w-full bg-black/[0.03] border border-black/5 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-black/5 flex justify-between items-center bg-black/[0.02]">
          <div>
            <h2 className="text-xl font-serif">Correct Row Data</h2>
            <p className="text-xs text-black/40 uppercase tracking-widest mt-1">Row ID: {row.id + 1}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {row.isPriceOutlier && (
            <div className="mb-8 p-6 bg-amber-50 border border-amber-100 rounded-3xl">
              <div className="flex items-center gap-2 text-amber-600 mb-4">
                <AlertCircle size={18} />
                <span className="text-sm font-bold uppercase tracking-wider">Price Inconsistency Detected</span>
              </div>
              <p className="text-xs text-amber-700/70 mb-4">
                This item's price ({row.currency || 'GBP'} {row.exc_vat_case}) appears to be an outlier.
                {row.priceOutlierType === 'global' 
                  ? ` It is significantly higher than the dataset median (${row.currency || 'GBP'} ${row.priceOutlierRef?.toFixed(2)}).`
                  : ` The average price for this wine in your file is approx. ${row.currency || 'GBP'} ${row.priceOutlierRef?.toFixed(2)}.`
                }
              </p>
              
              <div className="flex items-center gap-4 bg-white/50 p-4 rounded-xl border border-amber-100/50">
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase text-amber-600/50 mb-1">Current Price</p>
                  <p className="font-mono font-bold text-amber-900 text-lg">{row.exc_vat_case}</p>
                </div>
                <div className="w-px h-8 bg-amber-200/50" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase text-amber-600/50 mb-1">Suggested / Ref Price</p>
                  <p className="font-mono font-bold text-amber-900 text-lg">
                    {/* 
                      If reference is unit price, we need to convert back to case price?
                      The anomaly detection stores unit price (per 75cl).
                      But user edits Case Price.
                      Let's just show the unit price reference for context, or try to convert back if possible.
                      Actually, let's just show the reference value as "Unit Price (75cl)" to be safe.
                    */}
                    {row.priceOutlierRef?.toFixed(2)} <span className="text-[10px] font-normal text-amber-700/50">(Unit / 75cl)</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {originalRow && (
            <div className="mb-8 p-6 bg-amber-50 border border-amber-100 rounded-3xl">
              <div className="flex items-center gap-2 text-amber-600 mb-4">
                <Copy size={18} />
                <span className="text-sm font-bold uppercase tracking-wider">Duplicate Comparison</span>
              </div>
              <p className="text-xs text-amber-700/70 mb-4">
                This row (ID: {row.id + 1}) appears to be a duplicate of Row ID: {originalRow.id + 1}. 
                Compare the values below to decide if this row should be kept or deleted.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase text-amber-600/50">Current Row</p>
                  <div className="bg-white/50 p-3 rounded-xl border border-amber-100/50 space-y-1">
                    {['lwin7', 'vintage', 'case_size', 'size', 'tax_status', 'case_quantity', 'total_quantity'].map(k => (
                      <div key={k} className="flex justify-between text-[10px]">
                        <span className="text-amber-700/50">{k.replace(/_/g, ' ')}:</span>
                        <span className="font-mono font-bold text-amber-900">
                          {k === 'size' ? `${row[k]} cl` : String(row[k] || '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase text-amber-600/50">Original Row</p>
                  <div className="bg-white/50 p-3 rounded-xl border border-amber-100/50 space-y-1">
                    {['lwin7', 'vintage', 'case_size', 'size', 'tax_status', 'case_quantity', 'total_quantity'].map(k => (
                      <div key={k} className="flex justify-between text-[10px]">
                        <span className="text-amber-700/50">{k.replace(/_/g, ' ')}:</span>
                        <span className="font-mono font-bold text-amber-900">
                          {k === 'size' ? `${originalRow[k]} cl` : String(originalRow[k] || '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Issues Section */}
            <div>
              {row.errors.length > 0 && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl h-full">
                  <div className="flex items-center gap-2 text-rose-600 mb-2">
                    <AlertCircle size={16} />
                    <span className="text-xs font-bold uppercase tracking-wider">Identified Issues</span>
                  </div>
                  <ul className="space-y-1">
                    {row.errors.map((err: string, i: number) => (
                      <li key={i} className="text-sm text-rose-700/80">• {err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Raw Data Reference */}
            <div className="p-4 bg-black/[0.02] border border-black/5 rounded-2xl">
              <div className="flex items-center gap-2 text-black/40 mb-2">
                <Table size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Original File Data</span>
              </div>
              <div className="space-y-1 max-h-[100px] overflow-y-auto pr-2">
                {Object.entries(row.raw || {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[10px] border-b border-black/5 py-1">
                    <span className="text-black/40 font-medium">{k}</span>
                    <span className="text-black/60 truncate max-w-[150px]">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <form id="row-editor-form" onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {fields.map((field) => {
              const isDate = isDateField(field.key);
              const isMissing = field.required && !formData[field.key];
              return (
                <div key={field.key} className={`space-y-1.5 ${isDate ? 'pb-4' : ''}`}>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-black/40 ml-1">
                    {field.label} {field.required && <span className="text-rose-500">*</span>}
                  </label>
                  {isDate ? (
                    <DateInput
                      value={formData[field.key] || ''}
                      onChange={(v) => handleChange(field.key, v)}
                      className={`${baseInputCls} ${isMissing ? 'border-rose-200 bg-rose-50/30' : ''}`}
                    />
                  ) : (
                    <input
                      type="text"
                      value={formData[field.key] || ''}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      className={`${baseInputCls} ${isMissing ? 'border-rose-200 bg-rose-50/30' : ''}`}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                    />
                  )}
                </div>
              );
            })}
          </form>
        </div>

        <div className="p-6 border-t border-black/5 bg-black/[0.02] flex justify-between items-center">
          <div>
            {onDelete && (
              <button 
                onClick={() => {
                  if (confirm('Are you sure you want to delete this row?')) {
                    onDelete(row.id);
                  }
                }}
                className="flex items-center gap-2 text-rose-600 hover:text-rose-700 px-4 py-2 rounded-xl hover:bg-rose-50 transition-all text-xs font-bold uppercase tracking-widest"
              >
                <Trash2 size={14} />
                Delete Row
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-2 text-xs font-bold uppercase tracking-widest text-black/40 hover:text-black transition-colors"
            >
              Cancel
            </button>
            <button 
              form="row-editor-form"
              type="submit"
              className="flex items-center gap-2 bg-black text-white px-8 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg hover:scale-105 transition-all"
            >
              <Save size={14} />
              Save Changes
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
