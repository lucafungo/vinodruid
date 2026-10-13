import { SCHEMAS } from '../constants';
import type { DataType } from '../types';

export function rowsToCsv(
  schema: { fields: { key: string; label: string }[] },
  rows: any[],
  extraColumns?: { label: string; value: (row: any) => string }[]
): string {
  const escapeCsvValue = (raw: any): string => {
    let val = raw;
    if (typeof val === 'object' && val?.value !== undefined) val = `${val.currency} ${val.value}`;
    const stringVal = String(val ?? '');
    return (stringVal.includes(',') || stringVal.includes('"') || stringVal.includes('\n'))
      ? `"${stringVal.replace(/"/g, '""')}"`
      : stringVal;
  };
  const headers = [...schema.fields.map(f => f.label), ...(extraColumns?.map(c => c.label) ?? [])].join(',');
  const dataRows = rows.map(row => [
    ...schema.fields.map(field => escapeCsvValue(row[field.key])),
    ...(extraColumns?.map(c => c.value(row)) ?? []),
  ].join(','));
  return [headers, ...dataRows].join('\n');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv(csvContent: string, filename: string): void {
  downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), filename);
}

export async function downloadTemplate(dataType: DataType): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const fields = SCHEMAS[dataType].fields;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Template');

  const headerRow = worksheet.addRow(fields.map(f => f.label));
  headerRow.eachCell((cell, colNumber) => {
    const field = fields[colNumber - 1];
    cell.font = { bold: true };
    cell.border = { bottom: { style: 'thin' } };
    if (field.required) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
      cell.note = 'Mandatory Field';
    }
  });

  worksheet.columns.forEach(column => { column.width = 20; });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${dataType}_template.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
