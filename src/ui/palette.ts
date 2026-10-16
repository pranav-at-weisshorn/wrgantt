/**
 * Task colours. Bars are drawn with these at 45 % strength over white, so each one reads as a
 * soft pastel on the Gantt chart; the critical path stays red. The first eleven are the
 * template's phase colours, so existing projects keep their look.
 */
export interface TaskColour {
  name: string;
  hex: string;
}

export const TASK_COLOURS: TaskColour[] = [
  { name: 'Mocca', hex: '#8c7067' },
  { name: 'Sage', hex: '#6f8a6a' },
  { name: 'Mauve', hex: '#8a6f8f' },
  { name: 'Steel blue', hex: '#5f8496' },
  { name: 'Taupe', hex: '#a0907c' },
  { name: 'Terracotta', hex: '#b8826b' },
  { name: 'Slate', hex: '#6b6f94' },
  { name: 'Olive', hex: '#9a9a5c' },
  { name: 'Sand', hex: '#c8a46e' },
  { name: 'Teal', hex: '#6f9c9a' },
  { name: 'Forest', hex: '#4e7364' },
  { name: 'Rose', hex: '#b07a8a' },
  { name: 'Sky', hex: '#6f9bc4' },
  { name: 'Lavender', hex: '#9b8fc4' },
  { name: 'Peach', hex: '#d49a7a' },
  { name: 'Mint', hex: '#7fb59a' },
];

export function colourName(hex: string | undefined): string {
  if (!hex) return 'Automatic';
  return TASK_COLOURS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex;
}

/** How a colour looks on a bar: 45 % over white. */
export function pastel(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const mix = (c: number) => Math.round(c * 0.45 + 255 * 0.55);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}
