
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

  // Dynamic threshold based on input length
  let threshold = 3;
  if (normalizedInput.length <= 3) threshold = 1;
  else if (normalizedInput.length <= 6) threshold = 2;

  if (minDistance <= threshold) {
    return bestMatch;
  }

  return null;
}
