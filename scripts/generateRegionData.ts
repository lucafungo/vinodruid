import fs from 'fs';
import path from 'path';

const CSV_PATH = path.join(process.cwd(), 'temp_regions.csv');
const OUTPUT_PATH = path.join(process.cwd(), 'src', 'data', 'regionData.ts');

function parseCSV(content: string) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    // Handle simple CSV parsing (assuming no commas in values for now based on sample)
    // If there are commas in values, this split will break. 
    // Given the sample, it looks like standard CSV.
    // Let's use a slightly smarter regex for splitting: ,(?=(?:(?:[^"]*"){2})*[^"]*$)
    const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
    
    if (row.length < 3) continue; // Skip empty/invalid rows

    const entry: any = {};
    headers.forEach((h, idx) => {
      entry[h] = row[idx] || '';
    });
    data.push(entry);
  }
  return data;
}

function resolveCountry(name: string, nodes: Map<string, any>): string | null {
  let current = nodes.get(name.toLowerCase());
  const visited = new Set<string>();
  
  while (current) {
    if (visited.has(current.name.toLowerCase())) return null; // Cycle detected
    visited.add(current.name.toLowerCase());

    if (current.type.toLowerCase() === 'country') {
      return current.name;
    }
    
    if (!current.parent) return null;
    
    // Look up parent
    const parentNode = nodes.get(current.parent.toLowerCase());
    if (!parentNode) {
      // Fallback: If parent is not in nodes, maybe it IS a country but wasn't listed as a row?
      // Or maybe we can infer it.
      // For this dataset, usually parents are listed.
      return null;
    }
    current = parentNode;
  }
  return null;
}

function main() {
  try {
    const content = fs.readFileSync(CSV_PATH, 'utf-8');
    const rawData = parseCSV(content);
    
    // 1. Build Node Map
    const nodes = new Map<string, any>();
    
    // First pass: Register all nodes
    rawData.forEach(row => {
      const name = row['region'] || row['name']; // Header is 'Region' in the sample
      if (!name) return;
      
      // Store with lowercase key for case-insensitive lookup
      if (!nodes.has(name.toLowerCase())) {
        nodes.set(name.toLowerCase(), {
          name: name,
          type: row['type'],
          parent: row['parent']
        });
      }
    });

    // 2. Resolve and Flatten
    const outputData: any[] = [];
    const seen = new Set<string>();

    rawData.forEach(row => {
      const name = row['region'];
      const type = row['type']?.toLowerCase();
      const parent = row['parent'];
      
      if (!name || type === 'country') return;

      const country = resolveCountry(name, nodes);
      
      if (country) {
        let region = '';
        let sub_region = '';

        if (type === 'region') {
          region = name;
        } else if (type === 'sub-region') {
          region = parent;
          sub_region = name;
        } else if (type === 'commune-locale') {
          // Map Commune to Sub-Region for validation purposes, 
          // or keep structure if we want deeper validation.
          // For now, let's put it in sub_region or create a new field?
          // The app validates against 'region' and 'sub-region' fields.
          // So we should populate 'sub_region' with the commune name to allow it to pass validation.
          region = parent; // This might be a sub-region, but that's okay.
          sub_region = name;
        }

        // Create unique key to deduplicate
        const key = `${country}|${region}|${sub_region}`.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          outputData.push({
            country,
            region,
            'sub-region': sub_region,
            sub_region: sub_region // Duplicate for safety with different casing conventions
          });
        }
      }
    });

    // 3. Write Output
    const fileContent = `export const REGION_DATA = ${JSON.stringify(outputData, null, 2)};`;
    fs.writeFileSync(OUTPUT_PATH, fileContent);
    
    console.log(`Successfully processed ${outputData.length} regions.`);
    
  } catch (err) {
    console.error('Error processing regions:', err);
    process.exit(1);
  }
}

main();
