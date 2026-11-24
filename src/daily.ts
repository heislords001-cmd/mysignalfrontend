// "Today" for the daily plan, in Lagos time, as YYYY-MM-DD.
export const todayLagos = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
export type DailyPlan = { date: string; lot: number; risk_pct: number }
