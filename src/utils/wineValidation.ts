// Reference lists and fuzzy-matching helpers used to validate the "Type"/"Sub-Type" wine fields.
// WINE_TYPES/WINE_SUBTYPES/TYPE_TO_SUBTYPE are imported directly into App.tsx's processData() (to check a
// row's type/sub-type against the approved list and suggest corrections) and into RulesModal.tsx (to display
// the accepted values to the user).

// The full list of accepted wine "Type" values (top-level category).
export const WINE_TYPES = [
  'Red',
  'White',
  'Rose',
  'Orange',
  'Spirit',
  'Beer',
  'Cider',
  'Soft Drinks',
  'Assortment',
  'Miscellaneous',
  'Unknown'
];

// The full list of accepted "Sub-Type" values across all wine types combined (see TYPE_TO_SUBTYPE below for
// which sub-types are valid for a given type).
export const WINE_SUBTYPES = [
  // Red/White/Rose/Orange/Unknown
  'Still',
  'Sparkling',
  'Sweet',
  'Fortified',
  
  // Spirit
  'Absinthe',
  'Aperitif',
  'Aquavit',
  'Armagnac',
  'Bourbon',
  'Brandy',
  'Calvados',
  'Chartreuse',
  'Cognac',
  'Eau de Vie',
  'Gin',
  'Liqueur',
  'Mezcal',
  'Pisco',
  'Rhum',
  'Rum',
  'Schnapps',
  'Tequila',
  'Vodka',
  'Whiskey',
  'Whisky',

  // Beer
  'Amber',
  'American Blond',
  'Bitter',
  'Fruit Beer',
  'Lager',
  'Sour',
  'Stout',
  'Weiss',

  // Cider
  'Dry',
  'Perry',
  // 'Sweet' is already listed above
];

// Maps each wine Type to the Sub-Types considered valid for it, so App.tsx's processData() can flag a
// mismatched combination (e.g. Type "Beer" with Sub-Type "Cognac") even if both values are individually valid.
export const TYPE_TO_SUBTYPE: Record<string, string[]> = {
  'Red': ['Still', 'Sparkling', 'Sweet', 'Fortified'],
  'White': ['Still', 'Sparkling', 'Sweet', 'Fortified'],
  'Rose': ['Still', 'Sparkling', 'Sweet', 'Fortified'],
  'Orange': ['Still', 'Sparkling', 'Sweet', 'Fortified'],
  'Unknown': ['Still', 'Sparkling', 'Sweet', 'Fortified'],
  
  'Spirit': [
    'Absinthe', 'Aperitif', 'Aquavit', 'Armagnac', 'Bourbon', 'Brandy', 
    'Calvados', 'Chartreuse', 'Cognac', 'Eau de Vie', 'Gin', 'Liqueur', 
    'Mezcal', 'Pisco', 'Rhum', 'Rum', 'Schnapps', 'Tequila', 'Vodka', 
    'Whiskey', 'Whisky'
  ],
  
  'Beer': [
    'Amber', 'American Blond', 'Bitter', 'Fruit Beer', 'Lager', 'Sour', 'Stout', 'Weiss'
  ],
  
  'Cider': ['Dry', 'Perry', 'Sweet'],
  
  'Soft Drinks': ['Still', 'Sparkling'],
  
  'Assortment': [],
  'Miscellaneous': []
};

/**
 * Calculates the Levenshtein distance between two strings.
 * This measures the minimum number of single-character edits (insertions, deletions or substitutions)
 * required to change one word into the other.
 */
export function getLevenshteinDistance(a: string, b: string): number {
  // Standard dynamic-programming edit-distance matrix: matrix[i][j] holds the edit distance between the
  // first i characters of b and the first j characters of a.
  const matrix = [];

  // Increment along the first column of each row
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Increment each column in the first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          )
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Finds the closest match in a list of valid strings.
 * Returns the match if the distance is within the threshold, otherwise null.
 * Used by App.tsx's processData() to suggest a fix when a row's Type/Sub-Type is misspelled
 * (e.g. "Whit" -> "White") rather than just rejecting it outright.
 */
export function findClosestMatch(input: string, validOptions: string[]): string | null {
  if (!input) return null;

  const normalizedInput = input.trim().toLowerCase();
  let bestMatch = null;
  let minDistance = Infinity;

  for (const option of validOptions) {
    const normalizedOption = option.toLowerCase();

    // Exact match check (ignoring case)
    if (normalizedInput === normalizedOption) {
      return option;
    }

    const distance = getLevenshteinDistance(normalizedInput, normalizedOption);

    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = option;
    }
  }

  // Dynamic threshold based on input length: short words (e.g. "Red") can only differ by 1 character before
  // they risk matching the wrong option, while longer words can tolerate more typos relative to their length.
  let threshold = 3;
  if (normalizedInput.length <= 3) threshold = 1;
  else if (normalizedInput.length <= 6) threshold = 2;

  if (minDistance <= threshold) {
    return bestMatch;
  }

  return null;
}
