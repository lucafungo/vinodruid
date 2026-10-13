import { normalizeBottleSize, normalizeVintage, normalizeCurrency, normalizeDate, normalizeCountry } from './normalization';
import { WINE_TYPES, WINE_SUBTYPES, TYPE_TO_SUBTYPE, findClosestMatch } from './wineValidation';
import type { DataType, ProcessedRow, SchemaEntry } from '../types';

const PROCESS_CHUNK_SIZE = 300;
const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export async function runProcessData(
  data: any[],
  map: Record<string, string>,
  dataType: DataType,
  schema: SchemaEntry,
  refData: any[],
  ignoredDups: Set<number>,
  autoFixed: Record<number, string[]>,
  manualEdits: Record<number, string[]>,
  ignoredPrice: Set<number>,
  calcLogs: Record<number, Record<string, string>>,
  masterCellars: string[],
  masterClients: string[],
  onProgress?: (done: number, total: number) => void
): Promise<ProcessedRow[]> {
  const seenRows = new Map<string, number>();
  const seenCellarNames = new Map<string, number>();
  const seenCellarCodes = new Map<string, number>();
  const currentIgnored = ignoredDups;
  const currentIgnoredPrice = ignoredPrice;
  const currentAutoFixed = autoFixed;
  const currentManualEdits = manualEdits;
  const currentCalcLogs = calcLogs;

  const processed: any[] = [];
  for (let chunkStart = 0; chunkStart < data.length; chunkStart += PROCESS_CHUNK_SIZE) {
  const chunkEnd = Math.min(chunkStart + PROCESS_CHUNK_SIZE, data.length);
  for (let idx = chunkStart; idx < chunkEnd; idx++) {
    const row = data[idx];
    const result: any = { id: idx, raw: row, status: 'green', errors: [] as string[], fieldErrors: [] as string[] };
    let hasError = false;
    let hasWarning = false;

    // Helper to get mapped value
    const getValue = (key: string) => {
      // Priority 1: Manual edits — only trusted when this row actually has a recorded edit for
      // this field. Without the check, stale rawData writes from a previous edit session survive
      // a Remap and override the new constant/column mapping even after manualEditsMap is cleared.
      const schemaVal = row[key];
      const wasManuallyEdited = (currentManualEdits[idx] || []).includes(key);
      if (wasManuallyEdited && schemaVal !== undefined && schemaVal !== null && String(schemaVal).trim() !== '') return schemaVal;

      // Priority 2: Check virtual calculation field
      const aiCalcVal = row[`__ai_calculated_${key}__`];
      if (aiCalcVal !== undefined && aiCalcVal !== null && String(aiCalcVal).trim() !== '') return aiCalcVal;

      // Priority 3: Check the mapped original header (constant, concat, or column name)
      const mappedKey = map[key];
      if (mappedKey) {
        if (mappedKey.startsWith('__const__')) return mappedKey.slice(9);
        if (mappedKey.startsWith('__concat__')) {
          try {
            const def = JSON.parse(mappedKey.slice(10));
            return (def.cols as string[]).map(c => String(row[c] ?? '')).filter(Boolean).join(def.sep);
          } catch { return ''; }
        }
        const val = row[mappedKey];
        if (val !== undefined && val !== null && String(val).trim() !== '') return val;
      }

      return '';
    };

    // A valid 7-digit LWIN alone identifies the wine downstream, so the wine-identity fields below
    // (name, producer, vintage, country, region, type, sub-type — the same set the no-LWIN required-
    // fields check further down treats as substitutable by LWIN) are not individually validated when
    // present: their content isn't flagged even if it looks wrong, since LWIN is authoritative.
    const lwinForBypassCheck = String(getValue('lwin7') || '').replace(/[^0-9]/g, '');
    const hasValidLwin = (dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders')
      && lwinForBypassCheck.length === 7;

    // --- Field-Level Validation Loop ---
    schema.fields.forEach(field => {
      let rawValue = getValue(field.key);

      // --- Sanitization: LWIN7 ---
      // LWINs must be strictly numeric and max 7 digits.
      if (field.key === 'lwin7') {
         // Remove non-digits
         let val = String(rawValue || '').replace(/[^0-9]/g, '');
         // Truncate to 7 digits
         if (val.length > 7) val = val.substring(0, 7);

         // Update the value in the result
         rawValue = val;
         result[field.key] = val;

         // If it was present but invalid (e.g. letters), rawValue is now cleaned.
         // If it's empty after cleaning, it's missing.
      }

      const isMissing = rawValue === undefined || rawValue === null || String(rawValue).trim() === '';

      // --- Validation: Region/Sub-Region against Reference Data ---
      if ((field.key === 'region' || field.key === 'sub_region') && refData.length > 0 && !isMissing) {
         // Skipped entirely when the row has a valid LWIN — see hasValidLwin above.
         if (!hasValidLwin) {
           const val = String(rawValue).trim().toLowerCase();
           const rawCountry = getValue('country');
           const country = String(rawCountry || '').trim().toLowerCase();

           // Check if value exists in 'Region' column of reference data
           const entry = refData.find(r => r.Region?.toLowerCase() === val);

           if (!entry) {
             result.status = 'red';
             result.errors.push(`Invalid ${field.label}: '${rawValue}'. Not found in reference table.`);
             hasError = true;
             result.fieldErrors.push(field.key);
           } else if (country) {
             // Basic hierarchy check: is the country the parent or grandparent?
             let isMatch = false;
             let current = entry;
             let depth = 0;
             while (current && depth < 5) {
               if (current.Parent?.toLowerCase() === country || current.Region?.toLowerCase() === country) {
                 isMatch = true;
                 break;
               }
               const parentName = current.Parent;
               current = parentName ? refData.find(r => r.Region?.toLowerCase() === parentName.toLowerCase()) : null;
               depth++;
             }

             if (!isMatch) {
               result.status = 'red';
               result.errors.push(`${field.label} '${rawValue}' does not belong to country '${rawCountry}'.`);
               hasError = true;
               result.fieldErrors.push(field.key);
             }
           }
         }
         result[field.key] = rawValue;
      }
      else if (field.key === 'country' && refData.length > 0 && !isMissing) {
         const normalized = normalizeCountry(String(rawValue));
         const val = normalized.toLowerCase();
         // Skipped when the row has a valid LWIN — see hasValidLwin above.
         const isValid = hasValidLwin || refData.some(r => r.Region?.toLowerCase() === val && r.Type?.toLowerCase() === 'country');

         if (!isValid) {
           result.status = 'red';
           result.errors.push(`Invalid Country: '${rawValue}'. Not found in reference table.`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = normalized;
      }

      // --- Validation: Required Fields ---
      else if (field.key === 'lwin7') {
         // LWIN is optional in the schema — format is validated here if present, presence is validated per-row post-loop.
         if (!isMissing && String(rawValue).length !== 7) {
            result.status = 'red';
            result.errors.push(`LWIN7 must be exactly 7 digits.`);
            hasError = true;
            result.fieldErrors.push(field.key);
         }
      } else if (field.required && isMissing) {
        result.status = 'red';
        result.errors.push(`Missing mandatory field: ${field.label}`);
        hasError = true;
        result.fieldErrors.push(field.key);
      }

      // --- Validation: Specific Data Types ---

      // Cellar Name: No restriction on special characters
      if (field.key === 'cellar_name' && dataType === 'cellars') {
         result[field.key] = String(rawValue || '');
      }
      // Currency: 3 or 4 letter code
      else if (field.key === 'currency' && dataType === 'cellars') {
         let val = String(rawValue || '').trim();
         if (val === '£') val = 'GBP';
         else if (val === '€') val = 'EUR';
         else if (val === '$') val = 'USD';
         val = val.toUpperCase();
         if ((val.length < 3 || val.length > 4) && !isMissing) {
            result.status = 'red';
            result.errors.push(`Invalid Currency Code: ${rawValue}. Must be 3 or 4 letters (e.g. GBP, EUR)`);
            hasError = true;
            result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // Create as customer cellar: Y/N
      else if (field.key === 'create_as_customer_cellar' && dataType === 'cellars') {
         let val = String(rawValue || '').toUpperCase().trim();
         if (val === 'YES') val = 'Y';
         if (val === 'NO') val = 'N';

         if (val !== 'Y' && val !== 'N' && !isMissing) {
            result.status = 'red';
            result.errors.push(`Invalid value for ${field.label}: ${rawValue}. Must be Y or N.`);
            hasError = true;
            result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // Vintage: Year (1900-2026) or 'NV'
      else if (field.key === 'vintage') {
        const normVintage = normalizeVintage(rawValue);
        // Invalid-format error skipped when the row has a valid LWIN — see hasValidLwin above.
        if (normVintage === 'INVALID' && !hasValidLwin) {
          result[field.key] = rawValue;
          result.status = 'red';
          result.errors.push(`Invalid vintage: ${rawValue}. Must be YYYY, NV, or 1`);
          hasError = true;
          result.fieldErrors.push(field.key);
        } else {
          result[field.key] = normVintage === 'INVALID' ? rawValue : normVintage;
        }
      }
      // Bottle Size: Standardized to Centiliters (cl)
      else if (field.key === 'size') {
        const normSize = normalizeBottleSize(rawValue);
        if (normSize === null && !isMissing) {
          result[field.key] = rawValue;
          result.status = 'red';
          result.errors.push(`Invalid size format: ${rawValue}. Must be in cl (e.g. 75cl)`);
          hasError = true;
          result.fieldErrors.push(field.key);
        } else {
          result[field.key] = normSize;
        }
      }
      // Wine Names: Check for special characters (allowing Unicode letters/accents and standard/curly apostrophes)
      else if (field.key === 'listing_wine_name' || field.key === 'display_wine_name') {
         result[field.key] = String(rawValue || '');
      }
      // Case Size: 1-36
      else if (field.key === 'case_size') {
         const val = parseInt(String(rawValue || '0'), 10);
         if (!isNaN(val)) {
           if (val < 1 || val > 36) {
             result.status = 'red';
             result.errors.push(`Case size must be between 1 and 36. Found: ${val}`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
         } else if (!isMissing) {
           result.status = 'red';
           result.errors.push(`Invalid case size: ${rawValue}`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
      }
      // Tax Status: IB or DP only
      else if (field.key === 'tax_status') {
         const val = String(rawValue || '').toUpperCase().trim();
         if (val !== 'IB' && val !== 'DP' && !isMissing) {
           result.status = 'red';
           result.errors.push(`Tax Status must be 'IB' or 'DP'. Found: ${rawValue}`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // Wine Type: Fuzzy matching against known types
      else if (field.key === 'type') {
         const val = String(rawValue || '').trim();
         if (val) {
           const exactMatch = WINE_TYPES.find(t => t.toLowerCase() === val.toLowerCase());
           if (exactMatch) {
             result[field.key] = exactMatch; // Normalize
           } else if (hasValidLwin) {
             // Skipped when the row has a valid LWIN — see hasValidLwin above.
             result[field.key] = val;
           } else {
             const closest = findClosestMatch(val, WINE_TYPES);
             if (closest) {
               result.status = 'yellow';
               result.errors.push(`Invalid Type '${val}'. Did you mean '${closest}'?`);
             } else {
               result.status = 'red';
               result.errors.push(`Invalid Type '${val}'. Must be one of: ${WINE_TYPES.join(', ')}`);
               hasError = true;
               result.fieldErrors.push(field.key);
             }
             result[field.key] = val;
           }
         } else {
           result[field.key] = val;
         }
      }
      // Sub-Type: Validated against Type
      else if (field.key === 'sub_type') {
         const val = String(rawValue || '').trim();
         const currentType = result['type'];

         if (val) {
           const exactMatch = WINE_SUBTYPES.find(t => t.toLowerCase() === val.toLowerCase());
           let normalizedSubType = val;

           if (exactMatch) {
             normalizedSubType = exactMatch;
             result[field.key] = exactMatch;
           } else if (hasValidLwin) {
             // Skipped when the row has a valid LWIN — see hasValidLwin above.
             result[field.key] = val;
           } else {
             const closest = findClosestMatch(val, WINE_SUBTYPES);
             if (closest) {
               result.status = 'yellow';
               result.errors.push(`Invalid Sub-Type '${val}'. Did you mean '${closest}'?`);
             } else {
               result.status = 'red';
               result.errors.push(`Invalid Sub-Type '${val}'. Must be one of: ${WINE_SUBTYPES.join(', ')}`);
               hasError = true;
               result.fieldErrors.push(field.key);
             }
             result[field.key] = val;
           }

           // Check if Sub-Type is valid for the selected Type — skipped when the row has a valid LWIN.
           if (!hasValidLwin && currentType && TYPE_TO_SUBTYPE[currentType]) {
              const allowedSubTypes = TYPE_TO_SUBTYPE[currentType];
              const isAllowed = allowedSubTypes.some(st => st.toLowerCase() === normalizedSubType.toLowerCase());

              if (!isAllowed) {
                 result.status = 'red';
                 result.errors.push(`Sub-Type '${normalizedSubType}' is not valid for Type '${currentType}'. Allowed: ${allowedSubTypes.join(', ')}`);
                 hasError = true;
                 result.fieldErrors.push(field.key);
              }
           }
         } else {
           result[field.key] = val;
         }
      }
      // Cellar Name: Check against valid list
      else if (field.key === 'cellar_name') {
         const val = String(rawValue || '').trim();
         result[field.key] = val;
      }
      // Dates: Normalize to dd/mm/yyyy
      else if (field.key.includes('date') || field.key.endsWith('_on')) {
         const normDate = normalizeDate(rawValue);
         if (normDate) {
            result[field.key] = normDate;
         } else if (!isMissing) {
            result[field.key] = rawValue;
            result.status = 'red';
            result.errors.push(`Invalid date format: ${rawValue}. Must be dd/mm/yyyy`);
            hasError = true;
            result.fieldErrors.push(field.key);
         }
      }
      // Generic Options Validation
      else if (field.options) {
        const val = String(rawValue || '').trim();
        const cleanVal = val.replace(/\.$/, '');
        const isValid = field.options.some(opt =>
          opt.toLowerCase() === val.toLowerCase() ||
          opt.replace(/\.$/, '').toLowerCase() === cleanVal.toLowerCase()
        );

        if (!isValid && !isMissing) {
          result.status = 'red';
          result.errors.push(`Invalid ${field.label}: '${val}'. Please select from the accepted list.`);
          hasError = true;
          result.fieldErrors.push(field.key);
        }
        result[field.key] = val;
      }
      // Email Validation
      else if (field.key === 'email' || field.key === 'main_contact_email') {
         const val = String(rawValue || '').trim();
         if (!isMissing) {
           const atCount = (val.match(/@/g) || []).length;
           if (atCount !== 1 || val.includes(' ')) {
             result.status = 'red';
             result.errors.push(`Invalid email: '${val}'. Must contain exactly one @ and no spaces.`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
         }
         result[field.key] = val;
      }
      else if (field.key === 'address_line_1' || field.key === 'address_line_2' || field.key === 'address_line_3') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^\p{L}0-9\s,\-.'\/#&()""]/u.test(val)) {
           result.status = 'red';
           result.errors.push(`${field.label} contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      else if (field.key === 'city') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^\p{L}\s\-''.]/u.test(val)) {
           result.status = 'red';
           result.errors.push(`City contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         } else {
           const countryVal = String(getValue('country') || '').trim();
           if (countryVal && val.toLowerCase().includes(countryVal.toLowerCase()) && !isMissing) {
             result.status = 'yellow';
             result.errors.push(`City name '${val}' should not contain Country name '${countryVal}'`);
             hasWarning = true;
           }
         }
         result[field.key] = val;
      }
      else if (field.key === 'country') {
         const val = String(rawValue || '').trim();
         const cityVal = String(getValue('city') || '').trim();
         const countyVal = String(getValue('county') || '').trim();

         if ((cityVal && val.toLowerCase().includes(cityVal.toLowerCase())) ||
             (countyVal && val.toLowerCase().includes(countyVal.toLowerCase()))) {
            if (!isMissing) {
              result.status = 'yellow';
              result.errors.push(`Country name '${val}' should not contain City/County name`);
              hasWarning = true;
            }
         }
         result[field.key] = val;
      }
      else if (field.key === 'phone' || field.key === 'mobile') {
         let val = String(rawValue || '').trim();
         // Remove alphabets and special chars, keep leading 0, maybe keep +?
         // User said "Avoid alphabets and special characters", "ensure you are not losing the leading 0"
         // Assuming we keep digits and maybe spaces/plus for readability, but strictly user said avoid special chars.
         // Let's strip everything except digits.
         const original = val;
         val = val.replace(/[^0-9]/g, '');
         if (val !== original && !isMissing) {
            // If we stripped something, maybe we should warn or just autofix?
            // User said "Avoid alphabets... ensure not losing leading 0".
            // If original was "+44 123", new is "44123". Leading 0 might be lost if it was parsed as number before.
            // But rawValue comes from file. If CSV/Excel, leading 0 might be gone already if not careful.
            // We can't restore lost leading 0 easily without knowing locale.
            // But we can ensure we don't strip it if it's there.
            result.autoFixedFields = [...(result.autoFixedFields || []), field.key];
         }
         result[field.key] = val;
      }
      else if (field.key === 'forename' || field.key === 'surname') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^\p{L}\s\-''.]/u.test(val)) {
           result.status = 'red';
           result.errors.push(`${field.label} contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         } else {
           const suspicious = ['company', 'ltd', 'limited', 'plc', 'mr', 'mrs', 'miss', 'dr', 'sir'];
           const found = suspicious.find(s => new RegExp(`\\b${s}\\b`, 'i').test(val));
           if (found && !isMissing) {
             result.status = 'yellow';
             result.errors.push(`Possible invalid name (contains '${found}'). Ensure no company names or salutations.`);
             hasWarning = true;
           }
         }
         result[field.key] = val;
      }
      else if (field.key === 'currency' || field.key === 'so_currency' || field.key === 'po_currency') {
         let val = String(rawValue || '').trim();
         if (val === '£') val = 'GBP';
         else if (val === '€') val = 'EUR';
         else if (val === '$') val = 'USD';
         result[field.key] = val.toUpperCase() || rawValue;
      }
      else if (field.key === 'cost' || field.key === 'total' || field.key === 'price' || field.key.startsWith('exc_vat') || field.key === 'case_cost_price' || field.key === 'case_selling_price') {
        const normPrice = normalizeCurrency(rawValue);
        if (normPrice.value === null && !isMissing) {
          result[field.key] = rawValue; // Keep original value
          result.status = 'red';
          result.errors.push(`Invalid price format for ${field.label}: ${rawValue}`);
          hasError = true;
          result.fieldErrors.push(field.key);
        } else {
          result[field.key] = normPrice.value;
        }
      }
      else if (['abv', 'case_size', 'case_quantity', 'total_quantity', 'exchange_rate'].includes(field.key)) {
        const val = parseFloat(String(rawValue).replace(/[^0-9.]/g, ''));
        result[field.key] = isNaN(val) ? (isMissing ? '' : rawValue) : val;
        if (isNaN(val) && !isMissing) {
          result.status = 'red';
          result.errors.push(`Invalid numeric format for ${field.label}: ${rawValue}`);
          hasError = true;
          result.fieldErrors.push(field.key);
        } else if (
          (dataType === 'inventory' || dataType === 'client_reserves') &&
          (field.key === 'case_quantity' || field.key === 'total_quantity') &&
          !isNaN(val) && val === 0
        ) {
          result.status = 'red';
          result.errors.push(`${field.label} cannot be zero.`);
          hasError = true;
          result.fieldErrors.push(field.key);
        }
      }
      // Account code / cellar code: letters, digits, spaces, hyphens, underscores, slashes, dots
      else if (field.key === 'account_code' || field.key === 'cellar_code') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^A-Za-z0-9\s\-_\/.]/.test(val)) {
           result.status = 'red';
           result.errors.push(`${field.label} contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // County: letters, spaces, hyphens, apostrophes, dots
      else if (field.key === 'county') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^\p{L}\s\-''.]/u.test(val)) {
           result.status = 'red';
           result.errors.push(`County contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // Company name: letters, digits, spaces, common business punctuation
      else if (field.key === 'company_name') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^\p{L}0-9\s\-.,''()&\/]/u.test(val)) {
           result.status = 'red';
           result.errors.push(`Company Name contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // Cellar name: letters, digits, spaces, hyphens, commas, apostrophes, dots
      else if (field.key === 'cellar_name') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^\p{L}0-9\s\-,.']/u.test(val)) {
           result.status = 'red';
           result.errors.push(`Cellar Name contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // Supplier name: same rules as company name
      else if (field.key === 'supplier_name') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^\p{L}0-9\s\-.,''()&\/]/u.test(val)) {
           result.status = 'red';
           result.errors.push(`Supplier contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // PO number: alphanumeric plus hyphens, underscores, slashes, dots
      else if (field.key === 'po_number') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^A-Za-z0-9\s\-_\/.]/.test(val)) {
           result.status = 'red';
           result.errors.push(`PO Number contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      // Post code: letters, digits, spaces, hyphens
      else if (field.key === 'post_code') {
         const val = String(rawValue || '').trim();
         if (!isMissing && /[^A-Za-z0-9\s\-]/.test(val)) {
           result.status = 'red';
           result.errors.push(`Post Code contains invalid characters: '${val}'`);
           hasError = true;
           result.fieldErrors.push(field.key);
         }
         result[field.key] = val;
      }
      else {
        result[field.key] = rawValue || '';
      }
    });

    // Post-loop LWIN Validation
    if (dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders') {
      const lwinVal = result['lwin7'];
      const isLwinMissing = !lwinVal || String(lwinVal).trim() === '';

      if (isLwinMissing) {
          const isFieldPresent = (key: string) => {
             const val = result[key];
             return val !== undefined && val !== null && String(val).trim() !== '';
          };

          const missingFields: string[] = [];
          if (!isFieldPresent('listing_wine_name') && !isFieldPresent('display_wine_name')) missingFields.push('Wine Name');
          if (!isFieldPresent('producer')) missingFields.push('Producer');
          if (!isFieldPresent('vintage')) missingFields.push('Vintage');
          if (!isFieldPresent('country')) missingFields.push('Country');
          if (!isFieldPresent('region')) missingFields.push('Region');
          if (!isFieldPresent('type')) missingFields.push('Wine Type');

          if (missingFields.length > 0) {
             result.status = 'red';
             const msg = `No LWIN — required fields missing: ${missingFields.join(', ')}`;
             if (!result.errors.includes(msg)) result.errors.push(msg);
             hasError = true;
             result.fieldErrors.push('lwin7');
          }
      }
    }

    // --- Master Data Validation ---
    if ((dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders') && result['cellar_name']) {
      const cellarName = String(result['cellar_name']).trim();
      if (masterCellars.length > 0 && !masterCellars.includes(cellarName)) {
        result.status = 'red';
        result.errors.push(`Cellar '${cellarName}' not found in Master List. Please load Cellars first.`);
        hasError = true;
        result.fieldErrors.push('cellar_name');
      }
    }

    if ((dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders') && result['account_code']) {
      const accountCode = String(result['account_code']).trim();
      if (masterClients.length > 0 && !masterClients.includes(accountCode)) {
        result.status = 'red';
        result.errors.push(`Account Code '${accountCode}' not found. Please load Private Clients, Trade Clients, or Suppliers lists first.`);
        hasError = true;
        result.fieldErrors.push('account_code');
      }
    }

    // --- Duplicate Detection ---
    // Create a unique fingerprint for the row based on key fields.
    // If the fingerprint is seen before, mark as duplicate.
    // Rows flagged here drive the DuplicateComparisonModal / guided review queue (startDuplicateReview
    // above); dismissing one adds its id to ignoredDuplicates (currentIgnored here) so it's skipped next pass.
    let duplicateFingerprint = '';
    if (dataType === 'contacts' || dataType === 'private_clients' || dataType === 'trade_clients' || dataType === 'suppliers') {
       duplicateFingerprint = String(result['account_code'] || '').trim();
    } else if (dataType === 'cellars') {
       // Check for unique cellar name and cellar code
       const name = String(result['cellar_name'] || '').trim().toLowerCase();
       const code = String(result['cellar_code'] || '').trim().toLowerCase();

       if (name && seenCellarNames.has(name) && !currentIgnored.has(idx)) {
          result.status = 'red';
          result.errors.push(`Duplicate Cellar Name detected: ${result['cellar_name']}`);
          hasError = true;
          result.fieldErrors.push('cellar_name');
       } else if (name) {
          seenCellarNames.set(name, idx);
       }

       if (code && seenCellarCodes.has(code) && !currentIgnored.has(idx)) {
          result.status = 'red';
          result.errors.push(`Duplicate Cellar Code detected: ${result['cellar_code']}`);
          hasError = true;
          result.fieldErrors.push('cellar_code');
       } else if (code) {
          seenCellarCodes.set(code, idx);
       }

       // Use combined fingerprint for general duplicate detection if needed,
       // but name/code uniqueness is more specific here.
       duplicateFingerprint = `${name}|${code}`;
    } else if (dataType === 'inventory' || dataType === 'client_reserves') {
       // Rotation number (SKU) is the lot identifier — different rotation = different entry, never a duplicate.
       // Only flag when rotation_number is present and matches; skip the check entirely when it's absent.
       const rotNum = String(result['rotation_number'] || '').trim();
       if (rotNum) {
          const fields = ['rotation_number', 'lwin7', 'vintage', 'case_size', 'size', 'tax_status'];
          if (dataType === 'client_reserves') fields.push('account_code');
          duplicateFingerprint = fields.map(k => String(result[k] || '')).join('|');
       } else {
          duplicateFingerprint = ''; // no rotation number → can't confirm identity → skip
       }
    } else if (dataType === 'sales_orders') {
       duplicateFingerprint = ['so_number', 'lwin7', 'vintage', 'case_size', 'size']
        .map(k => String(result[k] || '')).join('|');
    } else if (dataType === 'purchase_orders') {
       duplicateFingerprint = ['po_number', 'lwin7', 'vintage', 'case_size', 'size']
        .map(k => String(result[k] || '')).join('|');
    } else {
       duplicateFingerprint = ['lwin7', 'vintage', 'case_size', 'size', 'tax_status']
        .map(k => String(result[k] || '')).join('|');
    }

    // Skip when: no fingerprint (rotation number absent for inventory/client_reserves), or client_reserves missing account_code.
    const skipDuplicateCheck = !duplicateFingerprint ||
      (dataType === 'client_reserves' && !String(result['account_code'] || '').trim());

    if (!skipDuplicateCheck && seenRows.has(duplicateFingerprint) && !currentIgnored.has(idx)) {
      result.isDuplicate = true;
      result.duplicateOf = seenRows.get(duplicateFingerprint);
      if (dataType === 'contacts' || dataType === 'private_clients' || dataType === 'trade_clients' || dataType === 'suppliers') {
         result.errors.push(`Duplicate Account Code detected: ${duplicateFingerprint}`);
      } else if (dataType === 'inventory') {
         result.errors.push('Suspect duplicate detected (Same Rotation #, LWIN, Vintage, Size, Tax Status)');
      } else if (dataType === 'client_reserves') {
         result.errors.push('Suspect duplicate detected (Same Account Code, Rotation #, LWIN, Vintage, Size, Tax Status)');
      } else if (dataType === 'sales_orders') {
         result.errors.push('Suspect duplicate detected (Same SO Number, LWIN, Vintage, Case Size, Bottle Size)');
      } else if (dataType === 'purchase_orders') {
         result.errors.push('Suspect duplicate detected (Same PO Number, LWIN, Vintage, Case Size, Bottle Size)');
      } else {
         result.errors.push('Suspect duplicate detected (Same LWIN, Vintage, Size, Tax Status)');
      }
      hasWarning = true; // Duplicates are warnings unless they also have errors
    } else if (!skipDuplicateCheck) {
      seenRows.set(duplicateFingerprint, idx);
    }

    // --- Custom Columns (user-defined extra output columns from SchemaMapper) ---
    Object.entries(map || {}).forEach(([fieldKey, header]) => {
      if (!fieldKey.startsWith('__custom_col__') || !header) return;
      if (header.startsWith('__const__')) { result[fieldKey] = header.slice(9); }
      else if (header.startsWith('__concat__')) {
        try { const def = JSON.parse(header.slice(10)); result[fieldKey] = (def.cols as string[]).map((c: string) => String(row[c] ?? '')).filter(Boolean).join(def.sep); }
        catch { result[fieldKey] = ''; }
      } else { result[fieldKey] = row[header] !== undefined && row[header] !== null ? String(row[header]) : ''; }
    });

    // --- Status Assignment (Preliminary) ---
    if (hasError) result.status = 'red';
    else if (hasWarning || result.isDuplicate) result.status = 'yellow';
    else result.status = 'green';

    // --- Apply Overrides ---
    if (currentAutoFixed[idx]) {
      result.autoFixedFields = currentAutoFixed[idx];
    }
    if (currentManualEdits[idx]) {
      result.manualEdits = currentManualEdits[idx];
    }
    if (currentCalcLogs[idx]) {
      result.calculationLogs = currentCalcLogs[idx];
    }

    processed.push(result);
  }
  onProgress?.(chunkEnd, data.length);
  if (chunkEnd < data.length) await yieldToMain();
  }

  // --- Price Anomaly Detection (Inventory and Client Reserves Only) ---
  // Runs as a second pass over the already-processed rows (needs the full set to compute medians/
  // group averages). Flagged rows drive the same guided-review modal as duplicates (startPriceReview
  // above, priceOutlier* fields), and dismissals are tracked in ignoredPriceWarnings (currentIgnoredPrice here).
  if (dataType === 'inventory' || dataType === 'client_reserves') {
    // 1. Collect Valid Unit Prices
    // Unit Price = exc_vat_case / case_size (or case_cost_price for client_reserves)
    // We only consider rows that have valid numeric values for these fields
    const validPrices: number[] = [];
    const rowPrices = new Map<number, number>(); // Map row ID to calculated unit price
    const groupedPrices = new Map<string, { total: number, count: number, prices: number[], rowIds: number[] }>(); // Group by LWIN+Vintage
    const priceToRowId = new Map<number, number>(); // Map unit price back to row ID (for median reference)

    processed.forEach(row => {
      const priceField = dataType === 'client_reserves' ? 'case_cost_price' : 'exc_vat_case';
      const price = parseFloat(row[priceField]);
      const caseSize = parseInt(row['case_size']);
      const size = parseFloat(row['size']); // Bottle size in cl, e.g. 75

      // Basic validity check for price calculation
      if (!isNaN(price) && !isNaN(caseSize) && caseSize > 0 && price > 0) {
         // Calculate normalized price per bottle (unit price)
         // If we want to be super precise, we divide by (case_size * size).
         // But usually "Unit Price" implies "Price per Bottle" in the trade context, assuming standard 75cl.
         // If sizes vary (magnums vs halves), we MUST normalize by volume.
         // Let's normalize to "Price per 75cl Bottle Equivalent".
         // Formula: (Price / CaseSize) * (75 / Size)
         // Example: Case of 6 Magnums (150cl) for £600.
         // Price per bottle (Magnum) = £100.
         // Price per 75cl equiv = £100 * (75/150) = £50.

         let unitPrice = price / caseSize;
         if (!isNaN(size) && size > 0) {
            unitPrice = unitPrice * (75 / size);
         }

         validPrices.push(unitPrice);
         rowPrices.set(row.id, unitPrice);
         priceToRowId.set(unitPrice, row.id);

         // Grouping for Consistency Check
         // Key: LWIN7 + Vintage (or Name + Vintage if LWIN missing)
         const key = `${row['lwin7'] || row['listing_wine_name'] || 'unknown'}_${row['vintage']}`;
         if (!groupedPrices.has(key)) {
           groupedPrices.set(key, { total: 0, count: 0, prices: [], rowIds: [] });
         }
         const group = groupedPrices.get(key)!;
         group.total += unitPrice;
         group.count += 1;
         group.prices.push(unitPrice);
         group.rowIds.push(row.id);
      }
    });

    if (validPrices.length > 0) {
      // 2. Global Outlier Detection
      // "if all the stuff is around X gbp, why one specific line is x times 50?"
      // Calculate Median
      validPrices.sort((a, b) => a - b);
      const mid = Math.floor(validPrices.length / 2);
      const medianPrice = validPrices.length % 2 !== 0 ? validPrices[mid] : (validPrices[mid - 1] + validPrices[mid]) / 2;
      const medianRowId = priceToRowId.get(validPrices[mid]);

      // Threshold: > 50x Median (User said "x times 50", taking it literally as a heuristic for massive error)
      // Also check for extremely low prices? < Median / 50?
      const highThreshold = medianPrice * 50;

      // 3. Apply Checks
      processed.forEach(row => {
         if (currentIgnoredPrice.has(row.id)) return;

         const unitPrice = rowPrices.get(row.id);
         if (unitPrice !== undefined) {
            // Check Global Outlier
            if (unitPrice > highThreshold) {
               if (row.status !== 'red') row.status = 'yellow';
               row.errors.push(`Potential Price Error: Value is significantly higher (>50x) than dataset median.`);
               row.isPriceOutlier = true;
               row.priceOutlierType = 'global';
               row.priceOutlierRef = medianPrice;
               row.priceOutlierRefRowId = medianRowId;
            }

            // Check Group Consistency
            // "if two same product and same vintage cost around a price, why the third one... costs much more or much less?"
            const key = `${row['lwin7'] || row['listing_wine_name'] || 'unknown'}_${row['vintage']}`;
            const group = groupedPrices.get(key);

            if (group && group.count >= 3) {
               // We have enough data points to compare
               const avgPrice = group.total / group.count;

               // If this specific row deviates significantly from the group average
               // Threshold: > 2x Average or < 0.5x Average (User said "much more or much less")
               if (unitPrice > avgPrice * 2) {
                  if (row.status !== 'red') row.status = 'yellow';
                  row.errors.push(`Price Inconsistency: Significantly higher than other entries for this wine.`);
                  row.isPriceOutlier = true;
                  row.priceOutlierType = 'high';
                  row.priceOutlierRef = avgPrice;
                  row.priceOutlierRefRowId = group.rowIds.find(id => id !== row.id);
               } else if (unitPrice < avgPrice * 0.5) {
                  if (row.status !== 'red') row.status = 'yellow';
                  row.errors.push(`Price Inconsistency: Significantly lower than other entries for this wine.`);
                  row.isPriceOutlier = true;
                  row.priceOutlierType = 'low';
                  row.priceOutlierRef = avgPrice;
                  row.priceOutlierRefRowId = group.rowIds.find(id => id !== row.id);
               }
            }
         }
      });
    }
  }

  // LWIN conflict detection: for inventory and client_reserves, if two rows share the same LWIN7
  // but have conflicting non-empty values in descriptive fields, both rows are flagged red.
  // A field only counts as a conflict when BOTH rows have a non-empty value that disagrees —
  // a blank field on one side is not a conflict (LWIN rows often leave descriptive fields empty).
  if (dataType === 'inventory' || dataType === 'client_reserves') {
    const LWIN_CONFLICT_FIELDS: { key: string; label: string }[] = [
      { key: 'listing_wine_name', label: 'Wine Name' },
      { key: 'display_wine_name', label: 'Display Wine Name' },
      { key: 'producer', label: 'Producer' },
      { key: 'country', label: 'Country' },
      { key: 'region', label: 'Region' },
      { key: 'sub_region', label: 'Sub Region' },
    ];

    // Group rows by their lwin7 value
    const lwinGroups = new Map<string, typeof processed>();
    processed.forEach(row => {
      const lwin = String(row['lwin7'] || '').trim();
      if (!lwin) return;
      if (!lwinGroups.has(lwin)) lwinGroups.set(lwin, []);
      lwinGroups.get(lwin)!.push(row);
    });

    lwinGroups.forEach(rows => {
      if (rows.length < 2) return;

      const conflictLabels: string[] = [];
      LWIN_CONFLICT_FIELDS.forEach(({ key, label }) => {
        // Gather distinct non-empty values across the group (case-insensitive)
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const seen = new Set<string>();
        rows.forEach(r => {
          const v = normalize(String(r[key] || ''));
          if (v) seen.add(v);
        });
        if (seen.size > 1) conflictLabels.push(label);
      });

      if (conflictLabels.length === 0) return;

      const msg = `LWIN conflict: this LWIN is shared with another row that has different ${conflictLabels.join(', ')}. Verify the LWIN is correct and fix or remove the conflicting row.`;
      rows.forEach(row => {
        row.status = 'red';
        row.errors.push(msg);
        if (!row.fieldErrors.includes('lwin7')) row.fieldErrors.push('lwin7');
      });
    });
  }

  return processed;
}
