// ============================================================
// Chart palette (ordered for visual distinction in pie/bar charts)
// ============================================================
export const CHART_COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8',
  '#82ca9d', '#ffc658', '#ff7c43', '#665191', '#a05195',
  '#d45087', '#f95d6a', '#ff7c43', '#2f4b7c', '#003f5c',
  '#7a5195', '#bc5090', '#ef5675', '#ff764a', '#ffa600',
  '#488f31', '#de425b', '#69b3a2', '#404080', '#f4a261',
];

// Named chart colors for specific, consistent series assignments
export const CHART = {
  billable:  '#7A7B6E', // GRAY[500] - warm grey
  ops:       '#16a34a', // green-600 - matches Time Split green
  secondary: '#FFBB28', // CHART_COLORS[2] - amber
  tertiary:  '#FF8042', // CHART_COLORS[3] - orange
  purple:    '#8B5CF6', // violet-500, metadata series
};

// Gray scale (matches @theme --color-gray-* in globals.css)
export const GRAY = {
  50:  '#F7F7F4',
  100: '#ECEDE5',
  200: '#E0E1D9',
  300: '#C9CAC0',
  400: '#A5A699',
  500: '#7A7B6E',
  600: '#5A5A48',
  700: '#484839',
  800: '#36362B',
  900: '#24241D',
  950: '#121210',
};

// Tooltip/label styling constants used by Recharts/D3
export const LABEL_LINE_COLOR = GRAY[400];
export const TOOLTIP_BORDER = GRAY[200];

// Practice-area accent colors for the admin Practice Composition tab, matched
// to the existing brand palette rather than the generic CHART_COLORS rotation.
export const PRACTICE_AREA_COLORS = {
  Corporate: '#274E12',
  Commercial: '#1CA33B', // == --color-cg-green
  'M&A': '#5A5A48',      // == GRAY[600] / --color-cg-dark
  'Non-profit': '#A5A699', // == GRAY[400]
};
