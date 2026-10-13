import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, HelpCircle, Edit2, RefreshCcw, Download, Upload } from 'lucide-react';
import type { Step } from '../types';

interface CurrentUser {
  forename?: string;
  display_name?: string;
  organisation_name?: string;
  user_access?: string;
}

interface AppHeaderProps {
  step: Step;
  currentUser: CurrentUser | null;
  allGreen: boolean;
  greenCount: number;
  redCount: number;
  showOnlyCorrect: boolean;
  showOnlyErrors: boolean;
  correctionsInputRef: React.RefObject<HTMLInputElement>;
  onGoHome: () => void;
  onShowAdmin: () => void;
  onLogout: () => void;
  onShowRules: () => void;
  onMarkComplete: () => void;
  onRemap: () => void;
  onStartNew: () => void;
  onExportCorrect: () => void;
  onExportErrors: () => void;
  onUploadCorrections: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
}

export function AppHeader({
  step, currentUser, allGreen, greenCount, redCount,
  showOnlyCorrect, showOnlyErrors, correctionsInputRef,
  onGoHome, onShowAdmin, onLogout, onShowRules,
  onMarkComplete, onRemap, onStartNew,
  onExportCorrect, onExportErrors, onUploadCorrections, onExport,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[#e0e8ef] shadow-[0_1px_4px_rgba(27,48,64,0.08)]">
      <div className="max-w-[98vw] mx-auto h-16 px-8 flex items-center justify-between gap-8">
        {/* Brand */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-3 cursor-pointer flex-shrink-0"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onGoHome(); }}
        >
          <span className="text-xl font-serif tracking-tight text-[#1b3040]">
            <span className="italic font-medium text-[#2d97af]">Druid</span>
          </span>
          <span className="hidden sm:block text-[10px] font-bold uppercase tracking-widest text-[#96adb8]">Wine Onboarding</span>
        </motion.div>

        {/* Step pips */}
        <div className="flex items-center gap-1">
          {(['Upload', 'Map', 'Review'] as const).map((label, idx) => {
            const n = idx + 1;
            const current = step === 'upload' ? 1 : (step === 'map' || step === 'manual') ? 2 : 3;
            const done = n < current;
            const active = n === current;
            return (
              <React.Fragment key={n}>
                <div className="flex flex-col items-center gap-0.5">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-all ${
                    done ? 'bg-[#3d8a5a] border-[#3d8a5a] text-white' :
                    active ? 'bg-[#2d97af] border-[#2d97af] text-white' :
                    'bg-white border-[#e0e8ef] text-[#96adb8]'
                  }`}>
                    {done ? <CheckCircle2 size={12} /> : n}
                  </div>
                  <span className={`text-[9px] font-semibold hidden sm:block ${active ? 'text-[#1b3040]' : done ? 'text-[#3d8a5a]' : 'text-[#96adb8]'}`}>{label}</span>
                </div>
                {idx < 2 && <div className={`w-8 h-0.5 mb-3 ${done ? 'bg-[#2d97af]' : 'bg-[#e0e8ef]'}`} />}
              </React.Fragment>
            );
          })}
        </div>

        {/* Right: user + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {currentUser && (
            <div className="text-right mr-2">
              <p className="text-sm font-semibold text-[#1b3040]">{currentUser.forename || currentUser.display_name}</p>
              <p className="text-[10px] text-[#96adb8] uppercase tracking-wider">{currentUser.organisation_name}</p>
            </div>
          )}
          {currentUser?.user_access === 'admin' && (
            <button
              onClick={onShowAdmin}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-[#e0e8ef] text-xs font-medium text-[#5a7080] hover:border-[#2d97af] hover:text-[#2d97af] transition-colors"
            >
              Admin
            </button>
          )}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-[#e0e8ef] text-xs font-medium text-[#5a7080] hover:border-[#2d97af] hover:text-[#2d97af] transition-colors"
          >
            Log out
          </button>
          <button
            onClick={onShowRules}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2d97af] rounded-lg text-xs font-medium text-white hover:bg-[#1b7d94] transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            Rules
          </button>

          {step === 'review' && (
            <div className="flex gap-2 ml-2">
              {allGreen && (
                <button
                  onClick={onMarkComplete}
                  className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider bg-[#3d8a5a] text-white px-4 py-1.5 rounded-full shadow-sm hover:bg-[#2d7a4a] transition-all flex-shrink-0"
                >
                  <CheckCircle2 size={13} />
                  Mark Complete
                </button>
              )}
              <button
                onClick={onRemap}
                className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider bg-white px-3 py-1.5 rounded-full border border-[#e0e8ef] shadow-sm hover:border-[#2d97af] transition-colors"
                title="Go back to column mapping — raw data is kept, manual edits are cleared"
              >
                <Edit2 size={13} />
                Remap
              </button>
              <button
                onClick={onStartNew}
                className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider bg-white px-3 py-1.5 rounded-full border border-[#e0e8ef] shadow-sm hover:border-[#2d97af] transition-colors"
              >
                <RefreshCcw size={13} />
                Start New
              </button>
              {showOnlyCorrect && greenCount > 0 && (
                <button
                  onClick={onExportCorrect}
                  className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider bg-emerald-600 text-white px-4 py-1.5 rounded-full shadow-sm hover:bg-emerald-700 transition-all"
                >
                  <Download size={13} />
                  Export Correct ({greenCount})
                </button>
              )}
              {showOnlyErrors && redCount > 0 && (
                <>
                  <input
                    type="file"
                    accept=".csv"
                    ref={correctionsInputRef}
                    onChange={onUploadCorrections}
                    className="hidden"
                  />
                  <button
                    onClick={onExportErrors}
                    className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider bg-rose-600 text-white px-4 py-1.5 rounded-full shadow-sm hover:bg-rose-700 transition-all"
                  >
                    <Download size={13} />
                    Export Errors ({redCount})
                  </button>
                  <button
                    onClick={() => correctionsInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider bg-white text-rose-600 border border-rose-200 px-4 py-1.5 rounded-full shadow-sm hover:bg-rose-50 transition-all"
                  >
                    <Upload size={13} />
                    Upload Fixes
                  </button>
                </>
              )}
              <button
                onClick={onExport}
                className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider bg-[#2d97af] text-white px-4 py-1.5 rounded-full shadow-sm hover:bg-[#1b7d94] transition-all"
              >
                <Download size={13} />
                Export CSV
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
