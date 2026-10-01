import React, { useState, useEffect } from 'react';
import { ArrowRight, Check, Sparkles, Calculator, Hash, Table2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// headers are the column names from the uploaded/pasted file (App.tsx's `headers` state).
// fields is the target schema for the selected data type (App.tsx's getCurrentSchema().fields) — what the
// app needs each row to have. onComplete receives the finished field-key -> source-header mapping (or a
// "__const__value" / "__ai_calculated_*__" sentinel, see below) — App.tsx's handleMappingComplete then uses
// it to build processedData from rawData. onCancel goes back to the upload step (App.tsx's goHome).
// requireEitherOr names two field keys where at least one (not necessarily both) must be mapped, e.g.
// ['lwin7', 'listing_wine_name'] for inventory-like imports that can identify a wine either way.
// previewRows (first few raw rows) are shown under each mapped column so the user can sanity-check the mapping.
interface SchemaMapperProps {
  headers: string[];
  fields: { key: string, label: string, required: boolean, hint?: string, noAutoCalc?: boolean }[];
  onComplete: (mapping: Record<string, string>) => void;
  onCancel: () => void;
  requireEitherOr?: [string, string];
  previewRows?: Record<string, any>[];
}

// Column-mapping step of the import wizard: lets the user match each uploaded file column to one of the
// app's expected fields. Rendered by App.tsx during step === 'map', right after FileUploader hands off the
// parsed file. Also offers two escape hatches per field: a constant value applied to every row, or (for a
// few numeric fields) letting the app auto-calculate the value from other mapped fields.
export const SchemaMapper: React.FC<SchemaMapperProps> = ({ headers, fields, onComplete, onCancel, requireEitherOr, previewRows = [] }) => {
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Best-effort auto-mapping run once when headers/fields are known: for each target field, try to find a
  // matching uploaded column by comparing normalized (lowercased, non-alphanumeric stripped) names, from
  // strictest to loosest match so a good exact match is never overridden by a looser one found later:
  //   1. exact match on label or key (e.g. "Vintage" header <-> "vintage" field)
  //   2. header contains the field label (e.g. header "Wine Vintage Year" contains "vintage")
  //   3. field label contains the header (e.g. short header "Vin" is contained in label "vintage")
  // Short strings (<=2/<=3 chars) are excluded from the fuzzy passes to avoid nonsense matches.
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

  // "Constant" mode is encoded by prefixing the stored mapping value with the sentinel "__const__" followed
  // by the literal value to apply to every row — this keeps mapping as a single Record<string,string> instead
  // of needing a separate data structure for constants.
  const isConstantMode = (key: string) => mapping[key]?.startsWith('__const__') ?? false;
  const getConstantValue = (key: string) => mapping[key]?.startsWith('__const__') ? mapping[key].slice(9) : '';

  const handleSelect = (fieldKey: string, header: string) => {
    setMapping(prev => ({ ...prev, [fieldKey]: header }));
  };

  const handleSetConstant = (fieldKey: string) => {
    setMapping(prev => ({ ...prev, [fieldKey]: '__const__' }));
  };

  const handleConstantChange = (fieldKey: string, value: string) => {
    setMapping(prev => ({ ...prev, [fieldKey]: `__const__${value}` }));
  };

  // Switches a field back from constant mode to picking a source column.
  const handleBackToColumn = (fieldKey: string) => {
    setMapping(prev => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  };

  // A field counts as "done" if it has a mapped column, or (in constant mode) a non-empty constant value typed in.
  const isFieldSatisfied = (key: string) => {
    const val = mapping[key];
    if (!val) return false;
    if (val.startsWith('__const__')) return val.length > 9;
    return true;
  };

  // These "canCalculate*" flags detect when a required numeric field can be derived from other mapped
  // fields instead of needing its own column (e.g. total_quantity = case_size * case_quantity), letting the
  // user skip mapping it. The actual calculation happens later in App.tsx once rows are built; this is just
  // the UI's way of knowing which fields to treat as optional-if-derivable.
  const totalQtyNoAutoCalc = !!fields.find(f => f.key === 'total_quantity')?.noAutoCalc;
  const canCalculateTotalQty = !totalQtyNoAutoCalc && mapping['case_size'] && mapping['case_quantity'] && !mapping['total_quantity'];
  const canCalculateCaseQty = mapping['total_quantity'] && mapping['case_size'] && !mapping['case_quantity'];
  const canCalculateTotalValue = (mapping['price'] || mapping['exc_vat_case'] || mapping['case_cost_price']) &&
    (mapping['total_quantity'] || (mapping['case_size'] && mapping['case_quantity'])) && !mapping['total'];
  const hasInsight = canCalculateTotalQty || canCalculateCaseQty || canCalculateTotalValue;

  const eitherOrSatisfied = !requireEitherOr || isFieldSatisfied(requireEitherOr[0]) || isFieldSatisfied(requireEitherOr[1]);

  const isComplete = eitherOrSatisfied && fields.filter(f => f.required).every(f => {
    if (isFieldSatisfied(f.key)) return true;
    if (f.key === 'total_quantity' && canCalculateTotalQty) return true;
    if (f.key === 'case_quantity' && canCalculateCaseQty) return true;
    return false;
  });

  const requiredFields = fields.filter(f => f.required);
  const optionalFields = fields.filter(f => !f.required);
  const mappedCount = fields.filter(f => isFieldSatisfied(f.key)).length;
  const mappedRequired = requiredFields.filter(f =>
    isFieldSatisfied(f.key) ||
    (f.key === 'total_quantity' && canCalculateTotalQty) ||
    (f.key === 'case_quantity' && canCalculateCaseQty)
  ).length;

  // Renders one field's row: the status icon + label on the left, and either a column <select>, a constant-
  // value input, or an "auto-calculated" indicator on the right, plus a small preview of sample values.
  const renderField = (field: { key: string, label: string, required: boolean, hint?: string, noAutoCalc?: boolean }, isReq: boolean) => {
    const isCalculatable = (field.key === 'total_quantity' && canCalculateTotalQty) ||
                           (field.key === 'case_quantity' && canCalculateCaseQty);
    const constMode = isConstantMode(field.key);
    const isMapped = constMode ? getConstantValue(field.key).length > 0 : !!mapping[field.key];

    return (
      <div key={field.key} className="flex items-start gap-2 min-w-0">
        <div className="w-40 flex-shrink-0 flex items-center gap-1 min-w-0 pt-[6px]">
          {isMapped ? (
            <Check size={9} className={`flex-shrink-0 ${constMode ? 'text-violet-500' : 'text-emerald-500'}`} />
          ) : isCalculatable ? (
            <Calculator size={9} className="text-sky-500 flex-shrink-0" />
          ) : (
            <div className={`w-[9px] h-[9px] rounded-full flex-shrink-0 ${isReq ? 'bg-rose-300' : 'bg-black/10'}`} />
          )}
          <span className={`text-xs truncate ${isReq ? 'text-black/80 font-medium' : 'text-black/50'}`}>
            {field.label}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {constMode ? (
              <>
                <input
                  type="text"
                  placeholder="value for all rows…"
                  value={getConstantValue(field.key)}
                  onChange={e => handleConstantChange(field.key, e.target.value)}
                  className="flex-1 min-w-0 text-[11px] border border-violet-200 bg-violet-50 text-violet-800 rounded-md px-2 py-[5px] outline-none focus:ring-1 focus:ring-violet-300 placeholder:text-violet-300"
                />
                <button
                  onClick={() => handleBackToColumn(field.key)}
                  title="Map to a column instead"
                  className="flex-shrink-0 flex items-center gap-0.5 text-[9px] text-black/30 hover:text-black/60 transition-colors"
                >
                  <Table2 size={9} />
                </button>
              </>
            ) : (
              <>
                <select
                  value={mapping[field.key] || (isCalculatable && !mapping[field.key] ? '__ai_calculated__' : '')}
                  onChange={(e) => handleSelect(field.key, e.target.value)}
                  className={`flex-1 min-w-0 text-[11px] border rounded-md px-2 py-[5px] focus:outline-none focus:ring-1 focus:ring-black/10 cursor-pointer transition-colors ${
                    isMapped
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : isCalculatable && !mapping[field.key]
                      ? 'bg-sky-50 border-sky-200 text-sky-700'
                      : 'bg-black/[0.02] border-black/10 text-black/70'
                  }`}
                >
                  {isCalculatable && !mapping[field.key] ? (
                    <option value="__ai_calculated__">✨ Auto-calculated</option>
                  ) : (
                    <option value="">— unmapped —</option>
                  )}
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleSetConstant(field.key)}
                  title="Fill all rows with a fixed value"
                  className="flex-shrink-0 flex items-center gap-0.5 text-[9px] text-black/25 hover:text-violet-500 transition-colors"
                >
                  <Hash size={9} />
                </button>
              </>
            )}
          </div>
          {field.hint && !constMode && (
            <span className="mt-0.5 block text-[9px] text-black/35 leading-none">{field.hint}</span>
          )}
          {constMode && (
            <span className="mt-0.5 block text-[9px] text-violet-400 leading-none">same value for every row</span>
          )}
          {!constMode && !isCalculatable && mapping[field.key] && previewRows.length > 0 && (() => {
            const col = mapping[field.key];
            const vals = previewRows
              .map(r => String(r[col] ?? '').trim())
              .filter(v => v !== '');
            if (vals.length === 0) return null;
            const display = vals
              .slice(0, 4)
              .map(v => v.length > 18 ? v.slice(0, 17) + '…' : v)
              .join(' · ');
            return (
              <span className="mt-0.5 block text-[9px] text-black/30 leading-none truncate">{display}</span>
            );
          })()}
        </div>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-4xl mx-auto bg-white rounded-2xl shadow-[0_2px_12px_rgba(27,48,64,0.08)] border border-[#e0e8ef] overflow-hidden"
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
          <span className="text-[9px] font-bold uppercase tracking-widest bg-violet-50 text-violet-600 px-2 py-1 rounded-full flex items-center gap-1">
            <Hash size={9} /> Constant
          </span>
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
            // Stamp sentinel values ("__ai_calculated_*__") into any derivable-but-unmapped fields so
            // App.tsx's handleMappingComplete knows to compute them rather than read them from a column.
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
