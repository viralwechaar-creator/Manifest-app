import { query } from '../db';

/**
 * Grading scales are configurable (Site settings → Academics) because boards and schools differ.
 * Each band is [minimum percentage, label]. The default is the plain percentage scale used until a school chooses another.
 */
export type Bands = [number, string][];
export const SCALES: Record<string, { label: string; bands: Bands }> = {
  percent_letters: { label: 'Percentage letters (A+ to F)', bands: [[90, 'A+'], [80, 'A'], [70, 'B'], [60, 'C'], [50, 'D'], [40, 'E'], [0, 'F']] },
  cbse_9point: { label: 'CBSE-style 9-point (A1 to E2)', bands: [[91, 'A1'], [81, 'A2'], [71, 'B1'], [61, 'B2'], [51, 'C1'], [41, 'C2'], [33, 'D'], [21, 'E1'], [0, 'E2']] },
  grade_points: { label: 'Grade points out of 10', bands: [[91, '10'], [81, '9'], [71, '8'], [61, '7'], [51, '6'], [41, '5'], [33, '4'], [0, 'Below 4']] },
};
export const SCALE_LABELS = Object.values(SCALES).map((s) => s.label);
export const BOARDS = ['CBSE', 'CISCE (ICSE / ISC)', 'State board', 'IB', 'Cambridge (IGCSE)', 'Other'];

let current: Bands = SCALES.percent_letters.bands;
let loadedAt = 0;
export const scaleKey = (label?: string | null) => Object.entries(SCALES).find(([, s]) => s.label === label)?.[0] ?? 'percent_letters';

/** The grade label for a percentage under the school's chosen scale. */
export function gradeOf(pct: number): string {
  return (current.find(([min]) => pct >= min) ?? current[current.length - 1])[1];
}
/** Re-reads the chosen scale (at most once a minute unless forced, e.g. right after settings are saved). */
export async function refreshGrading(force = false) {
  if (!force && Date.now() - loadedAt < 60_000) return;
  const v = (await query("select value from site_settings where key='grading_scale'")).rows[0]?.value;
  current = SCALES[scaleKey(v)].bands; loadedAt = Date.now();
}
export const activeScale = () => ({ bands: current });
