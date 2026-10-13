import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface ValidationProgressOverlayProps {
  isValidating: boolean;
  validationProgress: { done: number; total: number };
}

export function ValidationProgressOverlay({ isValidating, validationProgress }: ValidationProgressOverlayProps) {
  return (
    <AnimatePresence>
      {isValidating && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-xl p-8 w-[360px] text-center"
          >
            <p className="text-sm font-semibold text-black mb-1">Validating your file…</p>
            <p className="text-xs text-black/50 mb-4">
              {validationProgress.total > 0
                ? `${validationProgress.done.toLocaleString()} / ${validationProgress.total.toLocaleString()} rows`
                : 'Starting…'}
            </p>
            <div className="w-full h-2 bg-black/[0.06] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-[#1A1A1A] rounded-full"
                animate={{
                  width: validationProgress.total > 0
                    ? `${Math.min(100, (validationProgress.done / validationProgress.total) * 100)}%`
                    : '5%'
                }}
                transition={{ ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
