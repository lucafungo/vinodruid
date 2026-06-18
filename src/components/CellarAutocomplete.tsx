import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface CellarAutocompleteProps {
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
  onBlur: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const CellarAutocomplete: React.FC<CellarAutocompleteProps> = ({
  value,
  suggestions,
  onChange,
  onBlur,
  onKeyDown
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const filtered = suggestions.filter(s => 
        s.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredSuggestions(filtered);
      setHighlightedIndex(-1);
    }
  }, [value, suggestions, isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onBlur(value);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value, onBlur]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev < filteredSuggestions.length - 1 ? prev + 1 : prev));
      setIsOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length) {
        e.preventDefault();
        const selected = filteredSuggestions[highlightedIndex];
        onChange(selected);
        setIsOpen(false);
        onBlur(selected);
      } else {
        onKeyDown(e);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    } else {
      onKeyDown(e);
    }
  };

  const handleSelect = (suggestion: string) => {
    onChange(suggestion);
    setIsOpen(false);
    onBlur(suggestion);
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center bg-white">
      <input
        ref={inputRef}
        autoFocus
        type="text"
        className="w-full h-full px-3 py-1 outline-none text-sm pr-8"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
      />
      <button 
        className="absolute right-1 text-gray-400 hover:text-gray-600"
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronDown size={14} />
      </button>

      {isOpen && (filteredSuggestions.length > 0 || suggestions.length > 0) && (
        <div className="absolute top-full left-0 w-full max-h-60 overflow-auto bg-white border border-gray-200 shadow-xl z-50 rounded-b-md">
          {(value === '' ? suggestions : filteredSuggestions).map((suggestion, index) => (
            <div
              key={suggestion}
              className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${
                index === highlightedIndex ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50'
              }`}
              onClick={() => handleSelect(suggestion)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <span className="truncate">{suggestion}</span>
              {suggestion === value && <Check size={12} className="text-emerald-500" />}
            </div>
          ))}
          {(value !== '' && filteredSuggestions.length === 0) && (
            <div className="px-3 py-2 text-xs text-gray-400 italic">
              No matches found
            </div>
          )}
        </div>
      )}
    </div>
  );
};
