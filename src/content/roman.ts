const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

/** Chapter numbers: 1 → "I". */
export const roman = (n: number) => ROMAN[n - 1] ?? String(n)
