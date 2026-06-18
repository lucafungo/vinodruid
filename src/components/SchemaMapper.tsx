import React, { useState, useEffect } from 'react';
import { ArrowRight, Check, Sparkles, Calculator } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SchemaMapperProps {
  headers: string[];
  fields: { key: string, label: string, required: boolean, hint?: string, noAutoCalc?: boolean }[];
  onComplete: (mapping: Record<string, string>) => void;
  onCancel: () => void;
  requireEitherOr?: [string, string];
}

export const SchemaMapper: React.FC<SchemaMapperProps> = ({ headers, fields, onComplete, onCancel, requireEitherOr }) => {
  const [mapping, setMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    const autoMap: Record<string, string> = {};
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    fields.forEach(field => {
      const fLabel = clean(field.label);
      const fKey = clean(field.key);

      const exactMatch = headers.find(h => {
        const hClean = clean(h);
        return hClean === fLabel || hClean === fKey;
      });
      if (exactMatch) { autoMap[field.key] = exactMatch; return; }

      const strongMatch = headers.find(h => {
        const hClean = clean(h);
        return hClean.includes(fLabel) && fLabel.length > 2;
      });
      if (strongMatch) { autoMap[field.key] = strongMatch; return; }

      const weakMatch = headers.find(h => {
        const hClean = clean(h);
        return fLabel.includes(hClean) && hClean.length > 3;
      });
      if (weakMatch) { autoMap[field.key] = weakMatch; }
    });

    setMapping(autoMap);
  }, [headers, fields]);

  const handleSelect = (fieldKey: string, header: string) => {
    setMapping(prev => ({ ...prev, [fieldKey]: header }));
  };

  const totalQtyNoAutoCalc = !!fields.find(f => f.key === 'total_quantity')?.noAutoCalc;
  const canCalculateTotalQty = !totalQtyNoAutoCalc && mapping['case_size'] && mapping['case_quantity'] && !mapping['total_quantity'];
  const canCalculateCaseQty = mapping['total_quantity'] && mapping['case_size'] && !mapping['case_quantity'];
  const canCalculateTotalValue = (mapping['price'] || mapping['exc_vat_case'] || mapping['case_cost_price']) &&
    (mapping['total_quantity'] || (mapping['case_size'] && mapping['case_quantity'])) && !mapping['total'];
  const hasInsight = canCalculateTotalQty || canCalculateCaseQty || canCalculateTotalValue;

  const eitherOrSatisfied = !requireEitherOr || mapping[requireEitherOr[0]] || mapping[requireEitherOr[1]];

  const isComplete = eitherOrSatisfied && fields.filter(f => f.required).every(f => {
    if (mapping[f.key]) return true;
    if (f.key === 'total_quantity' && canCalculateTotalQty) return true;
    if (f.key === 'case_quantity' && canCalculateCaseQty) return true;
    return false;
  });

  const requiredFields = fields.filter(f => f.required);
  const optionalFields = fields.filter(f => !f.required);
  const mappedCount = fields.filter(f => mapping[f.key]).length;
  const mappedRequired = requiredFields.filter(f => mapping[f.key] ||
    (f.key === 'total_quantity' && canCalculateTotalQty) ||
    (f.key === 'case_quantity' && canCalculateCaseQty)
  ).length;

  const renderField = (field: { key: string, label: string, required: boolean, hint?: string, noAutoCalc?: boolean }, isReq: boolean) => {
    const isCalculatable = (field.key === 'total_quantity' && canCalculateTotalQty) ||
                           (field.key === 'case_quantity' && canCalculateCaseQty);
    const isMapped = !!mapping[field.key];

    return (
      <div key={field.key} className="flex items-center gap-2 min-w-0">
        <div className="w-40 flex-shrink-0 flex items-center gap-1 min-w-0">
          {isMapped ? (
            <Check size={9} className="text-emerald-500 flex-shrink-0" />
          ) : isCalculatable ? (
            <Calculator size={9} className="text-sky-500 flex-shrink-0" />
          ) : (
            <div className={`w-[9px] h-[9px] rounded-full flex-shrink-0 ${isReq ? 'bg-rose-300' : 'bg-black/10'}`} />
          )}
          <span className={`text-xs truncate ${isReq ? 'text-black/80 font-medium' : 'text-black/50'}`}>
            {field.label}
          </span>
        </div>
        <div className="flex-1 min-w-0 relative">
          <select
            value={mapping[field.key] || (isCalculatable && !isMapped ? '__ai_calculated__' : '')}
            onChange={(e) => handleSelect(field.key, e.target.value)}
            className={`w-full text-[11px] border rounded-md px-2 py-[5px] focus:outline-none focus:ring-1 focus:ring-black/10 cursor-pointer transition-colors ${
              isMapped
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : isCalculatable && !isMapped
                ? 'bg-sky-50 border-sky-200 text-sky-700'
                : 'bg-black/[0.02] border-black/10 text-black/70'
            }`}
          >
            {isCalculatable && !isMapped ? (
              <option value="__ai_calculated__">✨ Auto-calculated</option>
            ) : (
              <option value="">— unmapped —</option>
            )}
            {headers.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          {field.hint && (
            <span className="absolute top-full left-0 mt-0.5 text-[9px] text-black/35 whitespace-nowrap leading-none">{field.hint}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-4xl mx-auto bg-white rounded-2xl shadow-lg border border-black/5 overflow-hidden"
    >
      {/* Compact header */}
      <div className="px-5 py-3 border-b border-black/5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">Map your columns</h2>
          <span className="text-[10px] text-black/30 font-medium">{mappedCount} / {fields.length} mapped</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold uppercase tracking-widest bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full flex items-center gap-1">
            <Sparkles size={9} /> Auto-Mapped
          </span>
          {hasInsight && (
            <span className="text-[9px] font-bold uppercase tracking-widest bg-sky-50 text-sky-700 px-2 py-1 rounded-full flex items-center gap-1">
              <Calculator size={9} /> Auto-Calc
            </span>
          )}
        </div>
      </div>

      {/* Either/or notice */}
      <AnimatePresence>
        {requireEitherOr && !eitherOrSatisfied && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-[11px] text-amber-700">
              <span className="font-bold flex-shrink-0">!</span>
              <span>Map <strong>LWIN</strong> or <strong>Incoming Wine Name</strong> — at least one is required to identify wines.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slim insight bar */}
      <AnimatePresence>
        {hasInsight && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-2 bg-sky-50 border-b border-sky-100 flex items-center gap-2 text-[11px] text-sky-700">
              <Calculator size={11} className="flex-shrink-0" />
              <span>
                {canCalculateTotalQty && 'Total Quantity will be auto-calculated (Case Size × Case Qty). '}
                {canCalculateCaseQty && 'Case Quantity will be auto-calculated (Total Qty ÷ Case Size). '}
                {canCalculateTotalValue && 'Total Value will be auto-calculated. '}
                You can proceed without mapping these fields.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-5 space-y-5">
        {/* Required fields */}
        <section>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-black/30">Required</span>
            <div className="h-px flex-1 bg-black/8" />
            <span className="text-[9px] text-black/30">{mappedRequired}/{requiredFields.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3">
            {requiredFields.map(f => renderField(f, true))}
          </div>
        </section>

        {/* Optional fields */}
        <section>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-black/30">Optional</span>
            <div className="h-px flex-1 bg-black/8" />
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3">
            {optionalFields.map(f => renderField(f, false))}
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-black/[0.015] border-t border-black/5 flex justify-between items-center">
        <button
          onClick={onCancel}
          className="text-xs text-black/40 hover:text-black transition-colors"
        >
          Cancel and start over
        </button>
        <button
          disabled={!isComplete}
          onClick={() => {
            const finalMapping = { ...mapping };
            fields.forEach(f => {
              if (!finalMapping[f.key]) {
                if (f.key === 'total_quantity' && canCalculateTotalQty) finalMapping[f.key] = '__ai_calculated_total_quantity__';
                if (f.key === 'case_quantity' && canCalculateCaseQty) finalMapping[f.key] = '__ai_calculated_case_quantity__';
                if (f.key === 'total' && canCalculateTotalValue) finalMapping[f.key] = '__ai_calculated_total__';
              }
            });
            onComplete(finalMapping);
          }}
          className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
            isComplete
              ? 'bg-black text-white hover:scale-105 active:scale-95'
              : 'bg-black/10 text-black/30 cursor-not-allowed'
          }`}
        >
          Process Data
          <ArrowRight size={13} />
        </button>
      </div>
    </motion.div>
  );
};
