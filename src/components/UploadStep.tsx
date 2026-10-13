import { motion } from 'motion/react';
import { CheckCircle2, RefreshCcw, Play, Trash2, Plus, Download, AlertCircle, X } from 'lucide-react';
import { FileUploader } from './FileUploader';
import { SCHEMAS } from '../constants';
import type { DataType } from '../types';

interface UploadStepProps {
  dataType: DataType;
  completedTasks: Record<string, { completedAt?: string }>;
  masterCellars: string[];
  masterClients: string[];
  openCompletedDropdown: DataType | null;
  validationError: string | null;
  onSetDataType: (type: DataType) => void;
  onSetOpenCompletedDropdown: (type: DataType | null) => void;
  onSetValidationError: (error: string | null) => void;
  getActiveSessionForType: (type: DataType) => any;
  getCompletedSessionForType: (type: DataType) => any;
  onLoadSession: (id: number) => void;
  onReopenSession: (id: number, type: DataType) => void;
  onExportCompleted: (type: DataType) => void;
  onStartNew: (sessionId?: number, type?: DataType) => void;
  onClearMasterData: (category: string) => void;
  onShowAddLocation: () => void;
  onDownloadTemplate: () => void;
  onDownloadAllCompleted: () => void;
  onUpload: (data: any[], headers: string[], fileName: string) => void;
  onOpenManualEntry: () => void;
}

function DataTypeButton({
  type, dataType, completedTasks, masterCellars, masterClients,
  openCompletedDropdown,
  getActiveSessionForType, getCompletedSessionForType,
  onSetDataType, onSetValidationError, onSetOpenCompletedDropdown,
  onLoadSession, onReopenSession, onExportCompleted, onStartNew,
  onClearMasterData, onShowAddLocation,
}: {
  type: DataType;
  dataType: DataType;
  completedTasks: Record<string, { completedAt?: string }>;
  masterCellars: string[];
  masterClients: string[];
  openCompletedDropdown: DataType | null;
  getActiveSessionForType: (type: DataType) => any;
  getCompletedSessionForType: (type: DataType) => any;
  onSetDataType: (type: DataType) => void;
  onSetValidationError: (error: string | null) => void;
  onSetOpenCompletedDropdown: (type: DataType | null) => void;
  onLoadSession: (id: number) => void;
  onReopenSession: (id: number, type: DataType) => void;
  onExportCompleted: (type: DataType) => void;
  onStartNew: (sessionId?: number, type?: DataType) => void;
  onClearMasterData: (category: string) => void;
  onShowAddLocation: () => void;
}) {
  const isCompleted = !!completedTasks[type];
  const activeSession = getActiveSessionForType(type);
  const isInProgress = !!activeSession;

  return (
    <div key={type} className="relative group/btn">
      <button
        onClick={() => {
          if (isInProgress || isCompleted) {
            onSetOpenCompletedDropdown(openCompletedDropdown === type ? null : type);
            onSetDataType(type);
            onSetValidationError(null);
          } else {
            onSetDataType(type);
            onSetValidationError(null);
            onSetOpenCompletedDropdown(null);
          }
        }}
        className={`px-5 py-2 rounded-full text-xs font-semibold tracking-wider transition-all border-[1.5px] flex items-center gap-2 ${
          dataType === type
            ? (isInProgress
                ? 'bg-amber-500 text-white border-amber-500 shadow-md scale-105'
                : isCompleted
                  ? 'bg-[#3d8a5a] text-white border-[#3d8a5a] shadow-md scale-105'
                  : 'bg-[#2d97af] text-white border-[#2d97af] shadow-md scale-105')
            : (isInProgress
                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                : isCompleted
                  ? 'bg-[#edf7f1] text-[#3d8a5a] border-[#4a9a68] hover:bg-emerald-50'
                  : 'bg-white text-[#5a7080] border-[#e0e8ef] hover:border-[#2d97af] hover:text-[#2d97af]')
        }`}
      >
        {isCompleted && !isInProgress && <CheckCircle2 size={12} />}
        {isInProgress && <RefreshCcw size={12} className="animate-spin-slow" />}
        {SCHEMAS[type]?.label || type}
        {isInProgress && (
          <span className="ml-1 text-[8px] font-black opacity-60">RESUME</span>
        )}
        {((type === 'cellars' && masterCellars.length > 0) || (['contacts', 'private_clients', 'trade_clients', 'suppliers'].includes(type) && masterClients.length > 0)) && (
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isInProgress ? 'bg-amber-400' : 'bg-emerald-500'}`} />
        )}
      </button>

      {openCompletedDropdown === type && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-black/5 p-2 z-50 animate-in fade-in slide-in-from-top-2">
          {isInProgress && (
            <button
              onClick={() => onLoadSession(activeSession.id)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 hover:bg-amber-50 rounded-xl transition-colors mb-1"
            >
              <RefreshCcw size={14} />
              Resume Progress
            </button>
          )}

          {isCompleted && !isInProgress && (() => {
            const cs = getCompletedSessionForType(type);
            return cs ? (
              <button
                onClick={() => onReopenSession(cs.id, type)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors mb-1"
              >
                <Play size={14} />
                Reopen Session
              </button>
            ) : null;
          })()}

          {isCompleted && (
            <button
              onClick={() => onExportCompleted(type)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors mb-1"
            >
              <Download size={14} />
              Export Last
            </button>
          )}

          <button
            onClick={() => onStartNew(activeSession?.id, type)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
          >
            <Plus size={14} />
            Start New
          </button>
        </div>
      )}

      {((type === 'cellars' && masterCellars.length > 0) || (['contacts', 'private_clients', 'trade_clients', 'suppliers'].includes(type) && masterClients.length > 0)) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClearMasterData(type === 'cellars' ? 'cellars' : 'contacts');
          }}
          className="absolute -top-2 -right-2 p-1.5 bg-rose-500 text-white rounded-full shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity hover:bg-rose-600 z-10"
          title="Clear Master List"
        >
          <Trash2 size={10} />
        </button>
      )}
      {type === 'cellars' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onShowAddLocation();
          }}
          className="absolute -top-2 -left-2 p-1.5 bg-black text-white rounded-full shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity hover:bg-black/70 z-10"
          title="Add location manually"
        >
          <Plus size={10} />
        </button>
      )}
    </div>
  );
}

export function UploadStep({
  dataType, completedTasks, masterCellars, masterClients,
  openCompletedDropdown, validationError,
  onSetDataType, onSetOpenCompletedDropdown, onSetValidationError,
  getActiveSessionForType, getCompletedSessionForType,
  onLoadSession, onReopenSession, onExportCompleted, onStartNew,
  onClearMasterData, onShowAddLocation,
  onDownloadTemplate, onDownloadAllCompleted,
  onUpload, onOpenManualEntry,
}: UploadStepProps) {
  const dtBtnProps = {
    dataType, completedTasks, masterCellars, masterClients, openCompletedDropdown,
    getActiveSessionForType, getCompletedSessionForType,
    onSetDataType, onSetValidationError, onSetOpenCompletedDropdown,
    onLoadSession, onReopenSession, onExportCompleted, onStartNew,
    onClearMasterData, onShowAddLocation,
  };

  return (
    <div className="space-y-8">
      <div className="space-y-10 max-w-4xl mx-auto flex flex-col items-center">
        {/* Row 1: master listings & clients */}
        <div className="flex flex-col items-center gap-3 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          <span className="text-[10px] uppercase font-sans tracking-[0.2em] text-[#1b3040]/40 font-semibold mb-1">
            Master Files & Contacts
          </span>
          <div className="flex flex-wrap justify-center gap-4">
            {(['private_clients', 'trade_clients', 'suppliers', 'cellars'] as DataType[]).map((type) => (
              <DataTypeButton key={type} type={type} {...dtBtnProps} />
            ))}
          </div>
        </div>

        {/* Subdued separator line */}
        <div className="h-[1px] w-24 bg-[#e0e8ef] my-1"></div>

        {/* Row 2: transactional & stock data */}
        <div className="flex flex-col items-center gap-3 w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
          <span className="text-[10px] uppercase font-sans tracking-[0.2em] text-[#1b3040]/40 font-semibold mb-1">
            Transactions & Stock
          </span>
          <div className="flex flex-wrap justify-center gap-4">
            {(['inventory', 'client_reserves', 'sales_orders', 'purchase_orders'] as DataType[]).map((type) => (
              <DataTypeButton key={type} type={type} {...dtBtnProps} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-3 mb-8">
        {!(getActiveSessionForType(dataType) || completedTasks[dataType]) && (
          <button
            onClick={onDownloadTemplate}
            className="group flex items-center gap-3 px-5 py-3 bg-white border border-[#e0e8ef] rounded-xl shadow-sm hover:border-[#2d97af] hover:shadow-md transition-all"
          >
            <div className="p-2 bg-[#eaf5f9] rounded-lg group-hover:bg-[#d5eef5] transition-colors">
              <Download size={16} className="text-[#2d97af]" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#5a7080] group-hover:text-[#2d97af]">
              Download {SCHEMAS[dataType].label} Template
            </p>
          </button>
        )}
        {Object.keys(completedTasks).length >= 2 && (
          <button
            onClick={onDownloadAllCompleted}
            className="group flex items-center gap-3 px-5 py-3 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
          >
            <div className="p-2 bg-emerald-100 rounded-lg group-hover:bg-emerald-200 transition-colors">
              <Download size={16} className="text-emerald-700" />
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Download All Completed ({Object.keys(completedTasks).length} files)
            </p>
          </button>
        )}
      </div>

      {validationError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-2xl mx-auto p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-800"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">{validationError}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              <button
                onClick={() => onSetDataType('cellars')}
                className="text-xs font-bold uppercase tracking-wider hover:underline"
              >
                Switch to Cellars Import
              </button>
              <button
                onClick={() => onSetDataType('private_clients')}
                className="text-xs font-bold uppercase tracking-wider hover:underline text-indigo-700"
              >
                Switch to Private Clients
              </button>
              <button
                onClick={() => onSetDataType('trade_clients')}
                className="text-xs font-bold uppercase tracking-wider hover:underline text-indigo-700"
              >
                Switch to Trade Clients
              </button>
              <button
                onClick={() => onSetDataType('suppliers')}
                className="text-xs font-bold uppercase tracking-wider hover:underline text-indigo-700"
              >
                Switch to Suppliers
              </button>
            </div>
          </div>
          <button onClick={() => onSetValidationError(null)} className="p-1 hover:bg-rose-100 rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {/* Only show upload zone if NO active session and NOT marked as completed */}
      {!(getActiveSessionForType(dataType) || completedTasks[dataType]) ? (
        <div className="space-y-4">
          <FileUploader onUpload={onUpload} />
          <div className="max-w-2xl mx-auto flex items-center gap-4">
            <div className="flex-1 h-px bg-[#e0e8ef]" />
            <span className="text-xs text-[#96adb8] uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-[#e0e8ef]" />
          </div>
          <div className="max-w-2xl mx-auto flex justify-center">
            <button
              onClick={onOpenManualEntry}
              className="group flex items-center gap-3 px-5 py-3 bg-white border border-[#e0e8ef] rounded-xl shadow-sm hover:border-[#2d97af] hover:shadow-md transition-all"
            >
              <div className="p-2 bg-[#eaf5f9] rounded-lg group-hover:bg-[#d5eef5] transition-colors">
                <Plus size={16} className="text-[#2d97af]" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#5a7080] group-hover:text-[#2d97af]">
                Start from Empty
              </p>
            </button>
          </div>
        </div>
      ) : (() => {
        const activeSession = getActiveSessionForType(dataType);
        const completedSession = getCompletedSessionForType(dataType);
        const isCompleted = !activeSession && !!completedTasks[dataType];
        return isCompleted ? (
          <div className="max-w-2xl mx-auto p-12 bg-white rounded-3xl border border-dashed border-emerald-200 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-6 text-emerald-600">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-xl font-serif font-medium mb-2">Session Completed</h3>
            <p className="text-sm text-black/60 mb-2 max-w-sm">
              {SCHEMAS[dataType].label} data has been marked as complete.
            </p>
            {completedTasks[dataType]?.completedAt && (
              <p className="text-xs text-black/40 mb-8">
                Completed {new Date(completedTasks[dataType].completedAt!).toLocaleString()}
              </p>
            )}
            <div className="flex gap-4">
              {completedSession && (
                <button
                  onClick={() => onReopenSession(completedSession.id, dataType)}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-2"
                >
                  <Play size={16} />
                  Reopen Session
                </button>
              )}
              <button
                onClick={() => onExportCompleted(dataType)}
                className="px-6 py-3 bg-white border border-black/10 text-black/70 rounded-xl font-bold uppercase tracking-widest hover:bg-black/5 transition-all flex items-center gap-2"
              >
                <Download size={16} />
                Export
              </button>
              <button
                onClick={() => onStartNew(undefined, dataType)}
                className="px-6 py-3 bg-white border border-rose-200 text-rose-600 rounded-xl font-bold uppercase tracking-widest hover:bg-rose-50 transition-all flex items-center gap-2"
              >
                <Plus size={16} />
                Start New
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto p-12 bg-white rounded-3xl border border-dashed border-black/10 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-6 text-amber-600">
              <RefreshCcw className="animate-spin-slow" size={32} />
            </div>
            <h3 className="text-xl font-serif font-medium mb-2">Session in Progress</h3>
            <p className="text-sm text-black/60 mb-8 max-w-sm">
              You have an active session for {SCHEMAS[dataType].label}.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => { if (activeSession) onLoadSession(activeSession.id); }}
                className="px-6 py-3 bg-amber-500 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center gap-2"
              >
                <RefreshCcw size={16} />
                Resume Progress
              </button>
              <button
                onClick={() => onStartNew(activeSession?.id, dataType)}
                className="px-6 py-3 bg-white border border-rose-200 text-rose-600 rounded-xl font-bold uppercase tracking-widest hover:bg-rose-50 transition-all flex items-center gap-2"
              >
                <Plus size={16} />
                Start New
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
