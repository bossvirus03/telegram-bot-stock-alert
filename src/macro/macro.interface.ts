export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  indicator?: string;
  date: string; // ISO String (e.g. 2026-09-10T12:30:00.000Z)
  actual: number | string | null;
  forecast: number | string | null;
  previous: number | string | null;
  unit?: string;
  importance: number; // 1 = High, 0 = Medium, -1 = Low
  currency?: string;
  comment?: string;
  source?: string;
}

export interface MacroAnalysisResult {
  title: string;
  country: string;
  countryFlag: string;
  actualStr: string;
  forecastStr: string;
  previousStr: string;
  dateStr: string;
  timeStr: string;
  impactLevel: string; // ⭐⭐⭐ Cao (High Impact)
  differenceText?: string;
  assessment: string;
}
