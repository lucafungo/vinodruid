import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, RotateCw, RefreshCcw, RotateCcw, Copy, Calculator,
  Filter, LayoutGrid, CheckCircle2, AlertCircle, Trash2, Edit2,
  HelpCircle, Check, X,
} from 'lucide-react';
import { CellarAutocomplete } from './CellarAutocomplete';
import { SCHEMAS } from '../constants';
import type { DataType, ProcessedRow, SchemaEntry } from '../types';

interface PendingBulkAction {
  field: string;
  oldValue: string;
  newValue: string;
  rowIds: number[];
}

interface EditingCell {
  rowId: number;
  fieldKey: string;
}

interface ReviewTableProps {
  processedData: ProcessedRow[];
  dataType: DataType;
  mapping: Record<string, string>;
  regionRefData: any[];
  masterCellars: string[];
  greenCount: number;
  redCount: number;
  showOnlyErrors: boolean;
  showOnlyCorrect: boolean;
  showOnlyEdited: boolean;
  reviewPage: number;
  reviewPageSize: number;
  editingCell: EditingCell | null;
  pendingBulkAction: PendingBulkAction | null;
  isAiProcessing: boolean;
  history: any[];
  autoFixedMap: Record<number, string[]>;
  manualEditsMap: Record<number, string[]>;
  swapSourceKey: string | null;
  swapPickingTarget: boolean;
  setShowOnlyErrors: (v: boolean) => void;
  setShowOnlyCorrect: (v: boolean) => void;
  setShowOnlyEdited: (v: boolean) => void;
  setReviewPage: (v: number | ((p: number) => number)) => void;
  setReviewPageSize: (v: number) => void;
  setEditingCell: (cell: EditingCell | null) => void;
  setProcessedData: (data: ProcessedRow[]) => void;
  setPendingBulkAction: (action: PendingBulkAction | null) => void;
  setSwapSourceKey: (key: string | null) => void;
  setSwapPickingTarget: (v: boolean) => void;
  setComparingDuplicate: (v: { row1: number; row2: number } | null) => void;
  applyBulkFix: () => void;
  handleAiSmartFix: () => void;
  handleRevalidate: () => void;
  handleRevertAiFixes: () => void;
  handleUndo: () => void;
  startDuplicateReview: () => void;
  startPriceReview: () => void;
  handleSwapColumns: (targetKey: string) => void;
  startEditingCell: (rowId: number, fieldKey: string) => void;
  handleRowUpdate: (row: ProcessedRow, fieldKey: string) => void;
  handleDeleteRow: (rowId: number) => void;
  handleIgnoreDuplicate: (rowId: number) => void;
  handleIgnorePriceWarning: (rowId: number) => void;
  getCurrentSchema: () => SchemaEntry;
}

export function ReviewTable({
  processedData, dataType, mapping, regionRefData, masterCellars,
  greenCount, redCount,
  showOnlyErrors, showOnlyCorrect, showOnlyEdited,
  reviewPage, reviewPageSize,
  editingCell, pendingBulkAction, isAiProcessing, history,
  autoFixedMap, manualEditsMap,
  swapSourceKey, swapPickingTarget,
  setShowOnlyErrors, setShowOnlyCorrect, setShowOnlyEdited,
  setReviewPage, setReviewPageSize,
  setEditingCell, setProcessedData, setPendingBulkAction,
  setSwapSourceKey, setSwapPickingTarget, setComparingDuplicate,
  applyBulkFix, handleAiSmartFix, handleRevalidate, handleRevertAiFixes,
  handleUndo, startDuplicateReview, startPriceReview, handleSwapColumns,
  startEditingCell, handleRowUpdate, handleDeleteRow,
  handleIgnoreDuplicate, handleIgnorePriceWarning, getCurrentSchema,
}: ReviewTableProps) {
  const hasPending = Object.keys(manualEditsMap).length > 0 || Object.keys(autoFixedMap).length > 0;
  const noIssues = redCount === 0;
  const isReadyToCommit = hasPending && noIssues && !isAiProcessing;

  const filteredData = processedData.filter(row => {
    if (showOnlyErrors) return row.status === 'red';
    if (showOnlyCorrect) return row.status === 'green';
    if (showOnlyEdited) return manualEditsMap[row.id] !== undefined;
    return true;
  });

  const filteredCount = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / reviewPageSize));
  const clampedPage = Math.min(reviewPage, totalPages);
  const rangeStart = filteredCount === 0 ? 0 : (clampedPage - 1) * reviewPageSize + 1;
  const rangeEnd = Math.min(clampedPage * reviewPageSize, filteredCount);
  const pagedRows = filteredData.slice((clampedPage - 1) * reviewPageSize, clampedPage * reviewPageSize);
  const customCols = Object.keys(mapping).filter(k => k.startsWith('__custom_col__'));

  return (
    <div className="space-y-6">
      {/* Bulk fix banner */}
      <AnimatePresence>
        {pendingBulkAction && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-indigo-600 text-white p-6 rounded-[2.5rem] flex flex-col md:flex-row items-center gap-6 shadow-2xl overflow-hidden max-w-2xl w-full pointer-events-auto border-4 border-white/20"
            >
              <div className="flex items-center gap-4 flex-1">
                <div className="p-4 bg-white/20 rounded-2xl shrink-0">
                  <Sparkles size={32} className="text-white" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] opacity-80 mb-1">Smart Bulk Fix Detected</p>
                  <p className="text-lg font-medium leading-tight">
                    Found <span className="font-extrabold underline decoration-2 underline-offset-4">{pendingBulkAction.rowIds.length}</span> other rows with the same {pendingBulkAction.field.replace('_', ' ')} issue ('{pendingBulkAction.oldValue}').
                  </p>
                  <p className="text-sm mt-2 opacity-90">
                    Would you like to update them all to <span className="font-bold italic text-yellow-300">'{pendingBulkAction.newValue}'</span>?
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setPendingBulkAction(null)}
                  className="px-6 py-3 text-sm font-bold uppercase tracking-widest hover:bg-white/10 rounded-2xl transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={applyBulkFix}
                  className="px-8 py-3 bg-white text-indigo-600 rounded-2xl text-sm font-black uppercase tracking-widest shadow-[0_8px_20px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95 transition-all"
                >
                  Update All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Stat tiles + filter toggle */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch">
        <div className="flex-1 grid grid-cols-4 gap-4">
          <button
            onClick={() => { setShowOnlyErrors(false); setShowOnlyEdited(false); setShowOnlyCorrect(false); setReviewPage(1); }}
            className={`p-6 rounded-3xl border shadow-sm transition-all text-left ${
              !showOnlyErrors && !showOnlyEdited && !showOnlyCorrect
                ? 'bg-black border-black text-white ring-4 ring-black/10'
                : 'bg-white border-black/5 text-black hover:bg-black/[0.02]'
            }`}
          >
            <p className={`text-[10px] uppercase tracking-widest mb-1 ${!showOnlyErrors && !showOnlyEdited && !showOnlyCorrect ? 'text-white/60' : 'text-black/40'}`}>Total Rows</p>
            <p className="text-3xl font-serif">{processedData.length}</p>
          </button>

          <button
            onClick={() => { setShowOnlyErrors(false); setShowOnlyEdited(false); setShowOnlyCorrect(!showOnlyCorrect); setReviewPage(1); }}
            className={`p-6 rounded-3xl border shadow-sm transition-all text-left ${
              showOnlyCorrect
                ? 'bg-emerald-500 border-emerald-600 text-white ring-4 ring-emerald-100'
                : 'bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            <p className={`text-[10px] uppercase tracking-widest mb-1 ${showOnlyCorrect ? 'text-white/60' : 'text-emerald-600/60'}`}>Ready</p>
            <p className="text-3xl font-serif">{greenCount}</p>
          </button>

          <button
            onClick={() => { setShowOnlyErrors(true); setShowOnlyEdited(false); setShowOnlyCorrect(false); setReviewPage(1); }}
            className={`p-6 rounded-3xl border shadow-sm transition-all text-left ${
              showOnlyErrors
                ? 'bg-rose-500 border-rose-600 text-white ring-4 ring-rose-100'
                : 'bg-rose-50 border-rose-100 text-rose-700 hover:bg-rose-100'
            }`}
          >
            <p className={`text-[10px] uppercase tracking-widest mb-1 ${showOnlyErrors ? 'text-white/60' : 'text-rose-600/60'}`}>Issues</p>
            <p className="text-3xl font-serif">{redCount}</p>
          </button>

          <button
            onClick={() => { setShowOnlyErrors(false); setShowOnlyEdited(true); setShowOnlyCorrect(false); setReviewPage(1); }}
            className={`p-6 rounded-3xl border shadow-sm transition-all text-left ${
              showOnlyEdited
                ? 'bg-orange-500 border-orange-600 text-white ring-4 ring-orange-100'
                : 'bg-orange-50 border-orange-100 text-orange-700 hover:bg-orange-100'
            }`}
          >
            <p className={`text-[10px] uppercase tracking-widest mb-1 ${showOnlyEdited ? 'text-white/60' : 'text-orange-600/60'}`}>Manual Fixes</p>
            <p className="text-3xl font-serif">{Object.keys(manualEditsMap).length}</p>
          </button>
        </div>

        <div className="bg-white p-2 rounded-3xl border border-black/5 shadow-sm flex items-center gap-1">
          <button
            onClick={() => { setShowOnlyErrors(false); setShowOnlyCorrect(false); setReviewPage(1); }}
            className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${
              !showOnlyErrors && !showOnlyCorrect ? 'bg-black text-white shadow-lg' : 'text-black/40 hover:bg-black/5'
            }`}
          >
            <LayoutGrid size={14} />
            Full File
          </button>
          <button
            onClick={() => { setShowOnlyCorrect(true); setShowOnlyErrors(false); setReviewPage(1); }}
            className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${
              showOnlyCorrect ? 'bg-emerald-500 text-white shadow-lg' : 'text-black/40 hover:bg-black/5'
            }`}
          >
            <CheckCircle2 size={14} />
            Correct Only
          </button>
          <button
            onClick={() => { setShowOnlyErrors(true); setShowOnlyCorrect(false); setReviewPage(1); }}
            className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${
              showOnlyErrors ? 'bg-rose-500 text-white shadow-lg' : 'text-black/40 hover:bg-black/5'
            }`}
          >
            <Filter size={14} />
            Issues Only
          </button>
        </div>
      </div>

      {/* Data table card */}
      <div className="bg-white rounded-none border border-[#dadce0] shadow-sm overflow-hidden flex flex-col h-full">

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#f8f9fa] border-b border-[#dadce0]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {processedData.some(r => r.status === 'red') && (
                <button
                  onClick={handleAiSmartFix}
                  disabled={isAiProcessing}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                    isAiProcessing
                      ? 'bg-amber-50 text-amber-400 border-amber-200 cursor-not-allowed'
                      : 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600 shadow-sm active:scale-95'
                  }`}
                >
                  <Sparkles size={12} className={isAiProcessing ? 'animate-pulse' : ''} />
                  AI Smart Fix
                </button>
              )}

              <button
                onClick={handleRevalidate}
                disabled={isAiProcessing}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                  isAiProcessing
                    ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                    : isReadyToCommit
                      ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 shadow-md shadow-emerald-100 animate-pulse active:scale-95'
                      : 'bg-white text-black border-black/10 hover:bg-black/5 shadow-sm active:scale-95'
                }`}
              >
                <RotateCw size={12} className={isAiProcessing ? 'animate-spin' : ''} />
                {isReadyToCommit ? '→ Review Changes' : 'Review Change'}
              </button>

              {Object.keys(autoFixedMap).length > 0 && (
                <button
                  onClick={handleRevertAiFixes}
                  disabled={isAiProcessing}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 transition-all active:scale-95"
                >
                  <RefreshCcw size={12} />
                  Undo AI Changes
                </button>
              )}

              {history.length > 0 && (
                <button
                  onClick={handleUndo}
                  disabled={isAiProcessing}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-all active:scale-95"
                  title="Undo last manual edit (Ctrl+Z)"
                >
                  <RotateCcw size={12} />
                  Undo Edit
                </button>
              )}

              {processedData.some(r => r.isDuplicate) && (
                <button
                  onClick={startDuplicateReview}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all active:scale-95"
                >
                  <Copy size={12} />
                  Review Duplicates ({processedData.filter(r => r.isDuplicate).length})
                </button>
              )}

              {processedData.some(r => r.isPriceOutlier) && (
                <button
                  onClick={startPriceReview}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all active:scale-95"
                >
                  <Calculator size={12} />
                  Review Prices ({processedData.filter(r => r.isPriceOutlier).length})
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500"></div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Errors</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-sky-400"></div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">AI Calculated</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-400"></div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">AI Fixed / Warning</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Valid</span>
            </div>
          </div>
          <div className="text-[10px] font-medium text-black/40 italic">
            * Click any cell to edit. AI fixed cells are highlighted in yellow.
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1 h-[75vh]">
          <table className="w-full text-left border-collapse min-w-max">
            <thead className="sticky top-0 bg-[#f8f9fa] z-10">
              <tr className="text-[11px] font-medium text-[#5f6368] border-b border-[#dadce0]">
                <th className="w-12 px-2 py-1.5 text-center border-r border-[#dadce0] bg-[#f8f9fa] sticky left-0 z-20"></th>
                {SCHEMAS[dataType].fields.map(field => {
                  const isSource = swapSourceKey === field.key;
                  const isTarget = swapPickingTarget && swapSourceKey !== field.key;
                  return (
                    <th
                      key={field.key}
                      className={`px-3 py-1.5 border-r border-[#dadce0] font-normal min-w-[150px] select-none group/hdr ${
                        isSource ? 'bg-indigo-50 text-indigo-700' :
                        isTarget ? 'cursor-pointer hover:bg-indigo-50 hover:text-indigo-700' : ''
                      }`}
                      onClick={() => {
                        if (swapPickingTarget && !isSource) handleSwapColumns(field.key);
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{field.label}</span>
                        {isSource && !swapPickingTarget && (
                          <>
                            <button
                              onClick={e => { e.stopPropagation(); setSwapPickingTarget(true); }}
                              className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 whitespace-nowrap"
                            >
                              Swap with…
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); setSwapSourceKey(null); }}
                              className="px-1 py-0.5 text-[10px] text-black/30 hover:text-black/60 rounded"
                            >
                              ✕
                            </button>
                          </>
                        )}
                        {isSource && swapPickingTarget && (
                          <button
                            onClick={e => { e.stopPropagation(); setSwapSourceKey(null); setSwapPickingTarget(false); }}
                            className="px-1.5 py-0.5 text-[10px] bg-rose-100 text-rose-600 rounded hover:bg-rose-200 whitespace-nowrap"
                          >
                            Cancel
                          </button>
                        )}
                        {isTarget && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-600 rounded whitespace-nowrap">
                            click to swap
                          </span>
                        )}
                        {!isSource && !swapPickingTarget && (
                          <button
                            onClick={e => { e.stopPropagation(); setSwapSourceKey(field.key); setSwapPickingTarget(false); }}
                            className="px-1 py-0.5 text-[10px] text-black/0 group-hover/hdr:text-black/40 rounded transition-colors"
                            title="Swap this column with another"
                          >
                            ⇄
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
                {customCols.map(k => (
                  <th key={k} className="px-3 py-1.5 border-r border-[#dadce0] font-normal min-w-[150px] select-none">
                    <span className="text-purple-700">{k.slice(14)}</span>
                  </th>
                ))}
                <th className="px-3 py-1.5 w-32 font-normal border-l border-[#dadce0] sticky right-0 bg-[#f8f9fa] z-20 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map(row => (
                <tr key={row.id} className="border-b border-[#dadce0] hover:bg-[#f1f3f4] transition-colors group h-9">
                  <td className="px-2 py-1 text-center border-r border-[#dadce0] bg-[#f8f9fa] text-[10px] text-[#70757a] select-none sticky left-0 z-10">
                    {row.id + 1}
                  </td>
                  {SCHEMAS[dataType].fields.map(field => {
                    const val = row[field.key];
                    const isEditing = editingCell?.rowId === row.id && editingCell?.fieldKey === field.key;
                    const hasFieldError = row.fieldErrors?.includes(field.key);
                    const isAutoFixed = row.autoFixedFields?.includes(field.key);
                    const isManuallyEdited = row.manualEdits?.includes(field.key);
                    const calcLog = row.calculationLogs?.[field.key];

                    let bgClass = '';
                    if (isEditing) {
                      bgClass = 'bg-white p-0 ring-2 ring-indigo-500 z-20 shadow-lg';
                    } else if (hasFieldError) {
                      bgClass = 'bg-rose-50';
                    } else if (isManuallyEdited) {
                      bgClass = 'bg-orange-50';
                    } else if (isAutoFixed) {
                      bgClass = calcLog ? 'bg-sky-50' : 'bg-amber-50';
                    }

                    return (
                      <td
                        key={field.key}
                        data-cell={`${row.id}-${field.key}`}
                        className={`px-3 py-0 text-sm border-r border-[#dadce0] last:border-r-0 cursor-cell relative min-w-[150px] transition-all ${bgClass}`}
                        onClick={() => startEditingCell(row.id, field.key)}
                        title={calcLog || ''}
                      >
                        {isEditing ? (
                          field.options ? (
                            <select
                              autoFocus
                              className="w-full h-full px-3 py-1 bg-inherit outline-none text-sm appearance-none"
                              value={val === null || val === undefined ? '' : String(val)}
                              onChange={(e) => {
                                const newData = [...processedData];
                                const rowIndex = newData.findIndex(r => r.id === row.id);
                                newData[rowIndex] = { ...newData[rowIndex], [field.key]: e.target.value };
                                setProcessedData(newData);
                              }}
                              onBlur={(e) => {
                                setEditingCell(null);
                                const updatedRow = { ...row, [field.key]: e.target.value };
                                handleRowUpdate(updatedRow, field.key);
                              }}
                            >
                              <option value="">Select {field.label}...</option>
                              {field.options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (field.key === 'region' || field.key === 'sub_region') && (() => {
                            const rowCountry = String(row['country'] || '').trim().toLowerCase();
                            return rowCountry && regionRefData.some(r => r.Parent?.toLowerCase() === rowCountry);
                          })() ? (
                            <select
                              autoFocus
                              className="w-full h-full px-3 py-1 bg-inherit outline-none text-sm appearance-none"
                              value={val === null || val === undefined ? '' : String(val)}
                              onChange={(e) => {
                                if (!e.target.value) return;
                                setEditingCell(null);
                                const updatedRow = { ...row, [field.key]: e.target.value };
                                handleRowUpdate(updatedRow, field.key);
                              }}
                            >
                              <option value="">— select region —</option>
                              {Array.from(
                                new Map(
                                  regionRefData
                                    .filter(r => r.Parent?.toLowerCase() === String(row['country'] || '').trim().toLowerCase() && r.Type?.toLowerCase() !== 'country')
                                    .map(r => [r.Region, r])
                                ).values()
                              )
                                .sort((a, b) => a.Region.localeCompare(b.Region))
                                .map(r => (
                                  <option key={r.Region} value={r.Region}>{r.Region}</option>
                                ))}
                            </select>
                          ) : field.key === 'cellar_name' ? (
                            <CellarAutocomplete
                              value={val === null || val === undefined ? '' : String(val)}
                              suggestions={masterCellars}
                              onChange={(newVal) => {
                                const newData = [...processedData];
                                const rowIndex = newData.findIndex(r => r.id === row.id);
                                newData[rowIndex] = { ...newData[rowIndex], [field.key]: newVal };
                                setProcessedData(newData);
                              }}
                              onBlur={(finalVal) => {
                                setEditingCell(null);
                                const updatedRow = { ...row, [field.key]: finalVal };
                                handleRowUpdate(updatedRow, field.key);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  setEditingCell(null);
                                  const updatedRow = { ...row, [field.key]: (e.target as HTMLInputElement).value };
                                  handleRowUpdate(updatedRow, field.key);
                                }
                              }}
                            />
                          ) : (
                            <input
                              autoFocus
                              type="text"
                              className="w-full h-full px-3 py-1 bg-inherit outline-none text-sm"
                              value={val === null || val === undefined ? '' : String(val)}
                              onChange={(e) => {
                                const newData = [...processedData];
                                const rowIndex = newData.findIndex(r => r.id === row.id);
                                newData[rowIndex] = { ...newData[rowIndex], [field.key]: e.target.value };
                                setProcessedData(newData);
                              }}
                              onBlur={(e) => {
                                setEditingCell(null);
                                const updatedRow = { ...row, [field.key]: e.target.value };
                                handleRowUpdate(updatedRow, field.key);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  setEditingCell(null);
                                  const updatedRow = { ...row, [(e.target as HTMLInputElement).name || field.key]: (e.target as HTMLInputElement).value };
                                  handleRowUpdate(updatedRow, field.key);
                                }
                              }}
                            />
                          )
                        ) : (
                          <div className="flex items-center gap-2 h-full overflow-hidden">
                            {isAutoFixed && (
                              calcLog ? (
                                <Calculator size={10} className="text-sky-500 shrink-0" />
                              ) : (
                                <Sparkles size={10} className="text-amber-500 shrink-0" />
                              )
                            )}
                            {isManuallyEdited && (
                              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                            )}
                            <span className={`truncate whitespace-nowrap ${isAutoFixed ? (calcLog ? 'text-sky-900 font-medium' : 'text-amber-900 font-medium') : 'text-[#202124]'} ${isManuallyEdited ? 'text-orange-900 font-medium' : ''} ${hasFieldError ? 'text-rose-600 font-bold' : ''}`}>
                              {field.key === 'vintage' ? (
                                <span className={`px-1 rounded text-[11px] font-mono ${hasFieldError ? 'bg-rose-100' : ''}`}>
                                  {val}
                                </span>
                              ) : (
                                String(val || '')
                              )}
                            </span>
                            {field.key === 'lwin' && row.isDuplicate && (
                              <Copy size={10} className="text-amber-500 shrink-0" />
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {customCols.map(k => (
                    <td key={k} className="px-3 py-0 text-sm border-r border-[#dadce0] min-w-[150px]">
                      <span className="text-xs text-purple-800">{String(row[k] ?? '')}</span>
                    </td>
                  ))}
                  <td className="px-3 py-1 border-l border-[#dadce0] sticky right-0 bg-white group-hover:bg-[#f1f3f4] z-10">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteRow(row.id); }}
                        title="Remove this row"
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-0.5 rounded hover:bg-rose-100 text-black/20 hover:text-rose-500"
                      >
                        <X size={11} />
                      </button>
                      {row.status === 'red' ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const firstErrorField = row.fieldErrors?.[0] || (getCurrentSchema().fields[0]?.key || 'listing_wine_name');
                            startEditingCell(row.id, firstErrorField);
                          }}
                          title={row.errors.join('\n')}
                          className="bg-rose-600 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-rose-700 transition-colors flex items-center gap-1"
                        >
                          <AlertCircle size={10} />
                          Fix Issue
                        </button>
                      ) : row.isDuplicate ? (
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setComparingDuplicate({ row1: row.duplicateOf!, row2: row.id });
                            }}
                            title="Compare these rows side-by-side"
                            className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-sky-200 transition-colors flex items-center gap-1 border border-sky-200 w-full justify-center"
                          >
                            <HelpCircle size={10} />
                            Compare
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRow(row.id);
                            }}
                            title={`Suspect duplicate of row ${(row.duplicateOf ?? 0) + 1}. Click to remove.`}
                            className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-amber-200 transition-colors flex items-center gap-1 border border-amber-200 w-full justify-center"
                          >
                            <Trash2 size={10} />
                            Remove
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleIgnoreDuplicate(row.id);
                            }}
                            title="Mark as not a duplicate"
                            className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-gray-200 transition-colors flex items-center gap-1 border border-gray-200 w-full justify-center"
                          >
                            <Check size={10} />
                            Keep
                          </button>
                        </div>
                      ) : row.isPriceOutlier ? (
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditingCell(row.id, dataType === 'client_reserves' ? 'case_cost_price' : 'exc_vat_case');
                            }}
                            title="Modify price"
                            className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-indigo-200 transition-colors flex items-center gap-1 border border-indigo-200 w-full justify-center"
                          >
                            <Edit2 size={10} />
                            Modify
                          </button>
                          {row.priceOutlierRefRowId !== undefined && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setComparingDuplicate({ row1: row.priceOutlierRefRowId!, row2: row.id });
                              }}
                              title="Compare with reference row"
                              className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-sky-200 transition-colors flex items-center gap-1 border border-sky-200 w-full justify-center"
                            >
                              <HelpCircle size={10} />
                              Compare
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleIgnorePriceWarning(row.id);
                            }}
                            title="Keep this price"
                            className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-gray-200 transition-colors flex items-center gap-1 border border-gray-200 w-full justify-center"
                          >
                            <Check size={10} />
                            Keep
                          </button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-center w-full h-full cursor-help"
                          title={row.errors.length > 0 ? row.errors.join('\n') : 'Row is valid'}
                        >
                          <div className={`w-2.5 h-2.5 rounded-full ${
                            row.status === 'green' ? 'bg-emerald-500' : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                          }`} />
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#f8f9fa] border-t border-[#dadce0] text-[11px] text-[#5f6368]">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <select
              value={reviewPageSize}
              onChange={(e) => { setReviewPageSize(Number(e.target.value)); setReviewPage(1); }}
              className="border border-[#dadce0] rounded px-2 py-1 bg-white cursor-pointer"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span>{filteredCount === 0 ? '0 rows' : `${rangeStart}–${rangeEnd} of ${filteredCount}`}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setReviewPage(1)}
                disabled={clampedPage <= 1}
                className="px-2 py-1 rounded border border-[#dadce0] bg-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black/5"
                title="First page"
              >«</button>
              <button
                onClick={() => setReviewPage(p => Math.max(1, p - 1))}
                disabled={clampedPage <= 1}
                className="px-2 py-1 rounded border border-[#dadce0] bg-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black/5"
                title="Previous page"
              >‹</button>
              <span className="px-2">{clampedPage} of {totalPages}</span>
              <button
                onClick={() => setReviewPage(p => Math.min(totalPages, p + 1))}
                disabled={clampedPage >= totalPages}
                className="px-2 py-1 rounded border border-[#dadce0] bg-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black/5"
                title="Next page"
              >›</button>
              <button
                onClick={() => setReviewPage(totalPages)}
                disabled={clampedPage >= totalPages}
                className="px-2 py-1 rounded border border-[#dadce0] bg-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-black/5"
                title="Last page"
              >»</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
