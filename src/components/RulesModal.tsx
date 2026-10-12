import React, { useState } from 'react';
import { X, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { WINE_TYPES, WINE_SUBTYPES } from '../utils/wineValidation';

// isOpen/onClose control visibility (App.tsx's isRulesModalOpen, toggled from a "view rules" button).
// dataType picks which set of validation rules to display (e.g. 'inventory', 'cellars', 'contacts') — matches
// App.tsx's DataType/dataType state, so this always documents the rules for whatever import type is active.
interface RulesModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataType: string;
}

// Read-only reference modal explaining the validation rules for the currently selected data type — purely
// informational, does not affect actual validation (which lives in App.tsx's processData/validateRow and in
// utils/wineValidation.ts). Uses WINE_TYPES/WINE_SUBTYPES from wineValidation.ts to list accepted values.
export const RulesModal: React.FC<RulesModalProps> = ({ isOpen, onClose, dataType }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <Info className="w-5 h-5 text-indigo-600" />
                {dataType === 'contacts' || dataType === 'private_clients' || dataType === 'trade_clients' || dataType === 'suppliers' ? `${dataType === 'suppliers' ? 'Supplier' : dataType === 'trade_clients' ? 'Trade Client' : 'Private Client'} List Validation Rules` : 
                 dataType === 'cellars' ? 'Cellar List Validation Rules' : 
                 'Inventory Validation Rules'}
              </h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="space-y-4">
                <RuleItem 
                  title="Mandatory Fields" 
                  description="All mandatory fields must be filled. Any line with missing mandatory fields will be excluded."
                  type="critical"
                />
                
                {dataType === 'contacts' || dataType === 'private_clients' || dataType === 'trade_clients' || dataType === 'suppliers' ? (
                  <>
                    <RuleItem 
                      title="Account Code" 
                      description="Must be unique. Duplicates will be flagged."
                      type="critical"
                    />
                    <RuleItem 
                      title="Client Title" 
                      description="Must be a valid title (e.g., Mr, Mrs, Dr, Sir, etc.)."
                    />
                    {dataType === 'suppliers' ? (
                      <>
                        <RuleItem 
                          title="Company Name" 
                          description="Must be provided. This will be the main supplier identification."
                          type="critical"
                        />
                        <RuleItem 
                          title="Main Contact Email" 
                          description="Must contain '@' and have no spaces."
                          type="critical"
                        />
                      </>
                    ) : (
                      <>
                        <RuleItem 
                          title="Names" 
                          description="Forename and Surname must be separate. No company names or salutations allowed in name fields."
                        />
                        <RuleItem 
                          title="Email" 
                          description="Must contain '@' and have no spaces."
                          type="critical"
                        />
                      </>
                    )}
                    <RuleItem 
                      title="Address Line 1" 
                      description="Special characters (\, &lt;, &gt;, &quot;, ', #) are automatically removed."
                    />
                    <RuleItem 
                      title="City & Country" 
                      description="City name must not contain Country name, and vice-versa."
                    />
                    <RuleItem 
                      title="Phone & Mobile" 
                      description="Non-digit characters are removed. Leading zeros are preserved."
                    />
                    <RuleItem 
                      title="Payment Terms" 
                      description="Must match one of the accepted payment terms (e.g., 30 Days, Immediate, etc.)."
                    />
                  </>
                ) : dataType === 'cellars' ? (
                  <>
                    <RuleItem 
                      title="Cellar Name" 
                      description="Must be unique and contain no special characters. This name will be used to validate Inventory imports."
                      type="critical"
                    />
                    <RuleItem 
                      title="Cellar Code" 
                      description="Must be unique across all cellars."
                      type="critical"
                    />
                    <RuleItem 
                      title="Tax Status" 
                      description="Must be either 'IB' (In Bond) or 'DP' (Duty Paid)."
                      type="critical"
                    />
                    <RuleItem 
                      title="Currency" 
                      description="Must be a valid 3 or 4-letter currency code (e.g., GBP, EUR, USD)."
                    />
                    <RuleItem 
                      title="Email" 
                      description="Main contact email must be valid."
                      type="critical"
                    />
                    <RuleItem 
                      title="Customer Cellar" 
                      description="Must be 'Y' or 'N'. 'Yes' and 'No' are automatically converted."
                    />
                  </>
                ) : (
                  <>
                    <RuleItem
                      title="LWIN (Liv-ex Wine Identification Number)"
                      description="Mandatory. If LWIN is not provided, you must provide: Producer, Wine Name, Vintage, Country, Region, and Type. Sub-Type is optional. If a valid LWIN is provided, it identifies the wine on its own — Wine Name, Producer, Vintage, Country, Region, Type, and Sub-Type are not individually checked, even if they look wrong."
                      type="critical"
                    />
                    
                    <RuleItem
                      title="Wine Name"
                      description="Must not be abbreviated. All characters are accepted. Not checked if a valid LWIN is provided."
                    />

                    <RuleItem
                      title="Vintage"
                      description="Format: YYYY. Use 'NV' for Non-Vintage or '1' if N/A. Not checked if a valid LWIN is provided."
                    />
                    
                    <RuleItem 
                      title="Case Size" 
                      description="Minimum: 1 bottle. Maximum: 36 bottles."
                    />
                    
                    <RuleItem 
                      title="Bottle Size" 
                      description="Automatically converted to centilitres (cl). Accepts 'Magnum', 'Standard', '750ml', etc."
                    />
                    
                    <RuleItem 
                      title="Tax Status" 
                      description="Must be either 'IB' (In Bond) or 'DP' (Duty Paid)."
                      type="critical"
                    />
                    
                    <RuleItem 
                      title="Cellar Name" 
                      description="Must match a valid location from the Master Cellar List. Load Cellars first to enable this check."
                      type="critical"
                    />
                    
                    <RuleItem
                      title="Type & Sub-Type"
                      description="Must match the approved list. Suggestions provided for slight misspellings. Not checked if a valid LWIN is provided."
                      acceptedValues={{ 'Types': WINE_TYPES, 'Sub-Types': WINE_SUBTYPES }}
                    />

                    <RuleItem
                      title="Country & Region"
                      description="Validated against the master region list. Regions must belong to the specified country. Not checked if a valid LWIN is provided."
                    />
                    
                    <RuleItem 
                      title="Date Format" 
                      description="Automatically formatted to dd/mm/yyyy."
                    />
                  </>
                )}
              </div>
            </div>
            
            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
              >
                Understood
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

// One rule row in the modal: a title + description, optionally styled as "critical" (red), and optionally
// expandable to show the full list of accepted values (e.g. wine types/sub-types).
const RuleItem = ({ title, description, type = 'normal', acceptedValues }: { title: string, description: string, type?: 'normal' | 'critical', acceptedValues?: Record<string, string[]> }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`p-4 rounded-xl border ${type === 'critical' ? 'border-red-100 bg-red-50/50' : 'border-gray-100 bg-white'}`}>
      <div className="flex justify-between items-start">
        <div>
          <h3 className={`font-medium mb-1 ${type === 'critical' ? 'text-red-900' : 'text-gray-900'}`}>
            {title}
          </h3>
          <p className={`text-sm ${type === 'critical' ? 'text-red-700' : 'text-gray-600'}`}>
            {description}
          </p>
        </div>
        {acceptedValues && (
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-indigo-600 hover:text-indigo-700 p-1"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>
      
      {acceptedValues && isExpanded && (
        <div className="mt-3 pt-3 border-t border-gray-100/50 grid grid-cols-2 gap-4">
          {Object.entries(acceptedValues).map(([label, values]) => (
            <div key={label}>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</h4>
              <div className="flex flex-wrap gap-1">
                {values.map(v => (
                  <span key={v} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                    {v}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
