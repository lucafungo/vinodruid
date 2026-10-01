import React, { useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileText, X, Table as TableIcon } from 'lucide-react';
import { motion } from 'motion/react';

// onUpload is called once the file is parsed, with the row objects, the raw header row, and the file name —
// App.tsx's handleUpload uses this to populate rawData/headers and move the wizard into the 'map' step.
interface FileUploaderProps {
  onUpload: (data: any[], headers: string[], fileName: string) => void;
  accept?: string;
}

// Drag-and-drop / click-to-browse file picker for the initial "upload your data" step (step === 'upload' in
// App.tsx). Parses CSV/XLSX client-side with the xlsx library and hands the parsed rows to onUpload.
export const FileUploader: React.FC<FileUploaderProps> = ({ onUpload, accept = ".csv, .xlsx, .xls" }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // Reads the file (as binary for Excel, as text for CSV) and parses it via the xlsx library, which
  // handles both formats. Extracts the header row separately from the row objects so callers get both
  // the raw column names (for SchemaMapper) and the parsed data (for previews).
  const processFile = (file: File) => {
    const reader = new FileReader();
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    reader.onload = (e) => {
      const data = e.target?.result;
      if (!data) return;

      if (isExcel) {
        const workbook = XLSX.read(data, { type: 'binary' });
        // For now, we take the first sheet. In the future, we can let user select the tab.
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (json.length > 0) {
          const headers = json[0] as string[];
          const rows = XLSX.utils.sheet_to_json(worksheet);
          onUpload(rows, headers, file.name);
        }
      } else {
        // Handle CSV via XLSX (it supports it too)
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const headers = XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0] as string[];
        const rows = XLSX.utils.sheet_to_json(worksheet);
        onUpload(rows, headers, file.name);
      }
    };

    if (isExcel) {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsText(file);
    }
  };

  // preventDefault is required so onDrop actually fires (browsers otherwise navigate to the dropped file).
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-2xl mx-auto"
    >
      <div 
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-[#d0dde6] rounded-2xl p-6 flex flex-col items-center justify-center bg-white hover:border-[#2d97af] hover:bg-[#f0f8fb] transition-all cursor-pointer group"
      >
        <div className="w-10 h-10 bg-[#eaf5f9] rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
          <Upload className="text-[#2d97af]" size={20} />
        </div>
        <h3 className="text-base font-medium mb-1">Upload your data file</h3>
        <p className="text-[11px] text-black/40 mb-4 text-center max-w-xs">
          Drag and drop your .csv or .xlsx file here, or click to browse.
        </p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-black/30">
            <FileText size={12} />
            <span>CSV</span>
          </div>
          <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-black/30">
            <TableIcon size={12} />
            <span>Excel</span>
          </div>
        </div>
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          accept={accept} 
          className="hidden" 
        />
      </div>
    </motion.div>
  );
};
