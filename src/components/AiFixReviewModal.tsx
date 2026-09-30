import React from 'react';
import { X, Check, ArrowRight, Sparkles, RefreshCcw, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// isOpen/onClose control visibility (App.tsx's isAiReviewModalOpen state).
// changes is the list of AI-suggested fixes (App.tsx's aiChangesSummary), each with the row id, its original
// values, the fixed values, and which fields were touched.
// onConfirm(selectedIds) applies only the checked rows' fixes (App.tsx's confirmAiFixes); onRevert discards
// every pending AI change and clears the review queue.
interface AiFixReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  changes: Array<{
    id: number;
    original: any;
    fixed: any;
    fields: string[];
  }>;
  onConfirm: (selectedIds: number[]) => void;
  onRevert: () => void;
}

// Modal that lets the user review AI-driven data cleanup suggestions side by side (original vs. cleaned value)
// and pick which ones to keep before they're written back into processedData in App.tsx.
export const AiFixReviewModal: React.FC<AiFixReviewModalProps> = ({
  isOpen, 
  onClose, 
  changes, 
  onConfirm, 
  onRevert 
}) => {
  const [selectedIds, setSelectedIds] = React.useState<number[]>([]);

  // Every change starts pre-selected (checked) whenever the modal opens or the change set changes.
  React.useEffect(() => {
    if (isOpen) {
      setSelectedIds(changes.map(c => c.id));
    }
  }, [isOpen, changes]);

  if (!isOpen) return null;

  const toggleSelection = (id: number) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // Select-all / deselect-all checkbox in the table header.
  const toggleAll = () => {
    if (selectedIds.length === changes.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(changes.map(c => c.id));
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-black/10 font-sans"
      >
        <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between bg-black text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest">AI Clean Review</h2>
              <p className="text-[10px] text-white/50 font-mono tracking-tighter uppercase">
                {selectedIds.length} of {changes.length} changes selected
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-gray-50/50">
          <div className="w-full">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-white/80 backdrop-blur-md z-10 border-b border-black/5">
                <tr>
                  <th className="p-4 w-12">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black"
                      checked={selectedIds.length === changes.length && changes.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="p-4 text-left text-[10px] font-black uppercase tracking-widest text-black/40 w-24">Row</th>
                  <th className="p-4 text-left text-[10px] font-black uppercase tracking-widest text-black/40">Field</th>
                  <th className="p-4 text-left text-[10px] font-black uppercase tracking-widest text-black/40">Original Value</th>
                  <th className="p-4 text-left text-[10px] font-black uppercase tracking-widest text-black/40">AI Cleaned Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {changes.map((change) => (
                  <tr 
                    key={change.id}
                    className={`transition-colors border-l-4 ${selectedIds.includes(change.id) ? 'bg-white border-black' : 'bg-gray-50/50 border-transparent opacity-60'}`}
                  >
                    <td className="p-4 text-center">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-gray-300 text-black focus:ring-black"
                        checked={selectedIds.includes(change.id)}
                        onChange={() => toggleSelection(change.id)}
                      />
                    </td>
                    <td className="p-4">
                      <span className="text-[11px] font-bold text-black/60 font-mono">#{change.id + 1}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {change.fields.map(field => (
                          <span key={field} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md text-[9px] font-bold uppercase tracking-tight">
                            {field.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="space-y-1">
                        {change.fields.map(field => (
                          <div key={field} className="text-xs text-rose-500 font-medium italic line-through decoration-rose-300">
                            <span className="text-black/20 mr-1 font-mono uppercase text-[8px]">{field}:</span>
                            {String(change.original[field] || '—')}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="space-y-1">
                        {change.fields.map(field => (
                          <div key={field} className="text-xs text-emerald-600 font-bold flex items-center gap-2">
                             <span className="text-black/20 mr-1 font-mono uppercase text-[8px]">{field}:</span>
                             {String(change.fixed[field] || '—')}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {changes.length === 0 && (
              <div className="h-64 flex flex-col items-center justify-center text-center p-12">
                <div className="w-16 h-16 bg-black/5 text-black/20 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle size={32} />
                </div>
                <h3 className="text-lg font-bold text-black mb-2">No cleanup needed</h3>
                <p className="text-sm font-medium text-black/40 max-w-xs mx-auto">Gemini did not find any issues to fix in the raw data of these rows.</p>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-6 border-t border-black/5 bg-white flex items-center justify-between">
          <button
            onClick={onRevert}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-[0.15em] text-black/40 hover:text-rose-600 hover:bg-rose-50 transition-all border border-transparent hover:border-rose-100"
          >
            <RefreshCcw size={14} />
            Discard All
          </button>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-3 text-xs font-bold uppercase tracking-[0.15em] text-black/60 hover:bg-black/5 rounded-2xl transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(selectedIds)}
              disabled={selectedIds.length === 0}
              className="flex items-center gap-2 px-10 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.2em] bg-black text-white hover:bg-gray-800 transition-all shadow-xl shadow-black/10 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
            >
              <Check size={14} strokeWidth={3} />
              Apply {selectedIds.length} Changes
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
