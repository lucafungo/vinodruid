import React, { useState } from 'react';
import { X, MapPin } from 'lucide-react';
import { motion } from 'motion/react';

// onSave receives the completed form values (used by App.tsx's handleAddLocation to add a new cellar/location
// to the master list); onClose just dismisses the modal without saving.
interface AddLocationModalProps {
  onSave: (data: Record<string, string>) => void;
  onClose: () => void;
}

// Default/blank values for every field in the form, keyed the same way the backend cellar record is.
const EMPTY_FORM: Record<string, string> = {
  cellar_name: '',
  location_type: '',
  cellar_code: '',
  address_line_1: '',
  address_line_2: '',
  address_line_3: '',
  city: '',
  county: '',
  country: '',
  post_code: '',
  forename: '',
  surname: '',
  email: '',
  contact_type: '',
  mobile: '',
  phone: '',
  currency: '',
  internal_notes: '',
  create_as_customer_cellar: 'N',
  tax_status: 'IB',
};

// Field keys that must be non-empty before the form can be submitted.
const REQUIRED = [
  'cellar_name', 'location_type', 'cellar_code',
  'address_line_1', 'city', 'country',
  'forename', 'surname', 'email', 'contact_type',
  'currency', 'create_as_customer_cellar', 'tax_status',
];

// Modal dialog for manually adding a new cellar/location (with its main contact) to the master cellar list.
// Rendered by App.tsx when showAddLocationModal is true (triggered from the "Add Location" action, e.g. when
// a row references a cellar name that isn't in the master list yet).
export const AddLocationModal: React.FC<AddLocationModalProps> = ({ onSave, onClose }) => {
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  // Validates required fields locally before calling onSave; blocks submit and highlights missing fields otherwise.
  const handleSubmit = () => {
    const missing = REQUIRED.filter(k => !form[k]?.trim());
    if (missing.length > 0) {
      setErrors(missing);
      return;
    }
    setErrors([]);
    onSave(form);
  };

  // Renders a labelled text input bound to form[key]; half=true makes it span one grid column instead of two.
  const field = (key: string, label: string, required: boolean, half = false) => {
    const isErr = errors.includes(key);
    return (
      <div className={half ? '' : 'col-span-2'}>
        <label className="block text-[9px] font-semibold uppercase tracking-widest text-black/40 mb-1">
          {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
        </label>
        <input
          type="text"
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          className={`w-full text-sm border rounded-lg px-3 py-2 outline-none transition-colors focus:ring-1 ${
            isErr
              ? 'border-rose-300 bg-rose-50 focus:ring-rose-200'
              : 'border-black/10 bg-black/[0.02] focus:ring-black/10 focus:border-black/20'
          }`}
        />
      </div>
    );
  };

  // Same as field(), but renders a <select> dropdown instead of a free-text input.
  const selectField = (key: string, label: string, options: { value: string; label: string }[], required: boolean) => {
    const isErr = errors.includes(key);
    return (
      <div>
        <label className="block text-[9px] font-semibold uppercase tracking-widest text-black/40 mb-1">
          {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
        </label>
        <select
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          className={`w-full text-sm border rounded-lg px-3 py-2 outline-none transition-colors focus:ring-1 cursor-pointer ${
            isErr
              ? 'border-rose-300 bg-rose-50 focus:ring-rose-200'
              : 'border-black/10 bg-black/[0.02] focus:ring-black/10 focus:border-black/20'
          }`}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[32px] shadow-2xl border border-black/5 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-8 pb-5 border-b border-black/5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-black/5 text-black/60">
              <MapPin size={22} />
            </div>
            <div>
              <h2 className="text-2xl font-serif font-medium">Add Location</h2>
              <p className="text-sm text-black/40">Fill in the details and save to add it to your master list.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Form */}
        <div className="overflow-auto flex-1 p-8 space-y-6">
          {errors.length > 0 && (
            <div className="text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2.5">
              Please fill in all required fields.
            </div>
          )}

          {/* Location */}
          <section>
            <p className="text-[9px] font-bold uppercase tracking-widest text-black/25 mb-3">Location</p>
            <div className="grid grid-cols-2 gap-3">
              {field('cellar_name', 'Cellar Name', true, true)}
              {field('location_type', 'Location Type', true, true)}
              {field('cellar_code', 'Cellar Code', true, true)}
            </div>
          </section>

          {/* Address */}
          <section>
            <p className="text-[9px] font-bold uppercase tracking-widest text-black/25 mb-3">Address</p>
            <div className="grid grid-cols-2 gap-3">
              {field('address_line_1', 'Address Line 1', true)}
              {field('address_line_2', 'Address Line 2', false)}
              {field('address_line_3', 'Address Line 3', false)}
              {field('city', 'City', true, true)}
              {field('county', 'County', false, true)}
              {field('country', 'Country', true, true)}
              {field('post_code', 'Post Code', false, true)}
            </div>
          </section>

          {/* Main Contact */}
          <section>
            <p className="text-[9px] font-bold uppercase tracking-widest text-black/25 mb-3">Main Contact</p>
            <div className="grid grid-cols-2 gap-3">
              {field('forename', 'First Name', true, true)}
              {field('surname', 'Surname', true, true)}
              {field('email', 'Email', true)}
              {field('contact_type', 'Contact Type', true)}
              {field('mobile', 'Mobile', false, true)}
              {field('phone', 'Phone', false, true)}
            </div>
          </section>

          {/* Settings */}
          <section>
            <p className="text-[9px] font-bold uppercase tracking-widest text-black/25 mb-3">Settings</p>
            <div className="grid grid-cols-2 gap-3">
              {field('currency', 'Currency', true, true)}
              {selectField('tax_status', 'Tax Status', [
                { value: 'IB', label: 'IB — In Bond' },
                { value: 'DP', label: 'DP — Duty Paid' },
              ], true)}
              {selectField('create_as_customer_cellar', 'Create as Customer Cellar', [
                { value: 'N', label: 'N — No' },
                { value: 'Y', label: 'Y — Yes' },
              ], true)}
              <div className="col-span-2">
                <label className="block text-[9px] font-semibold uppercase tracking-widest text-black/40 mb-1">Internal Notes</label>
                <textarea
                  value={form['internal_notes']}
                  onChange={e => set('internal_notes', e.target.value)}
                  rows={2}
                  className="w-full text-sm border border-black/10 bg-black/[0.02] rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-black/10 focus:border-black/20 resize-none"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="p-8 pt-0 border-t border-black/5 flex justify-end gap-3 mt-0 bg-black/[0.015]">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-full text-sm font-medium text-black/40 hover:text-black transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-8 py-2.5 bg-black text-white rounded-full text-sm font-medium hover:scale-105 active:scale-95 transition-all shadow-lg"
          >
            Save Location
          </button>
        </div>
      </motion.div>
    </div>
  );
};
