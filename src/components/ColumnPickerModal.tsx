import React from 'react';
import { Check, ArrowRight } from 'lucide-react';
import { SCHEMAS } from '../constants';
import type { DataType, SchemaEntry } from '../types';

interface ColumnPickerModalProps {
  dataType: DataType;
  schema: SchemaEntry;
  pickerSelectedKeys: Set<string>;
  setPickerSelectedKeys: (keys: Set<string>) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ColumnPickerModal({
  dataType, schema, pickerSelectedKeys, setPickerSelectedKeys, onConfirm, onClose,
}: ColumnPickerModalProps) {
  const requiredFields = schema.fields.filter(f => f.required);
  const optionalFields = schema.fields.filter(f => !f.required);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-black/10">
          <h2 className="text-xl font-serif font-medium">Choose columns for {SCHEMAS[dataType].label}</h2>
          <p className="text-sm text-black/50 mt-1">Required fields are always included. Select the optional columns you need.</p>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-black/30 mb-3">Required — always included</p>
            <div className="grid grid-cols-2 gap-2">
              {requiredFields.map(f => (
                <div key={f.key} className="flex items-center gap-2 px-3 py-2 bg-black/[0.02] rounded-lg opacity-60">
                  <div className="w-4 h-4 rounded border-2 border-black/30 bg-black/10 flex items-center justify-center flex-shrink-0">
                    <Check className="w-2.5 h-2.5 text-black/60" />
                  </div>
                  <span className="text-sm text-black/70">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-widest text-black/30">Optional</p>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setPickerSelectedKeys(new Set([...Array.from(pickerSelectedKeys), ...optionalFields.map(f => f.key)]))}
                  className="text-indigo-600 hover:underline"
                >All</button>
                <span className="text-black/20">·</span>
                <button
                  onClick={() => setPickerSelectedKeys(new Set(requiredFields.map(f => f.key)))}
                  className="text-black/40 hover:underline"
                >None</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {optionalFields.map(f => {
                const checked = pickerSelectedKeys.has(f.key);
                return (
                  <label key={f.key} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-black/[0.02] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        const next = new Set(pickerSelectedKeys);
                        if (e.target.checked) next.add(f.key); else next.delete(f.key);
                        setPickerSelectedKeys(next);
                      }}
                      className="rounded"
                    />
                    <span className="text-sm text-black/70">{f.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="p-6 border-t border-black/10 flex justify-between items-center">
          <p className="text-xs text-black/40">{pickerSelectedKeys.size} columns selected</p>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-black/50 hover:text-black transition-colors">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-xl hover:bg-black/80 transition-colors"
            >
              Start Entering Data
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
