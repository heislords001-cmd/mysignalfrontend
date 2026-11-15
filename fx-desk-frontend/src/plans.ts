// Keep these prices in sync with api/verify.ts (the server checks what was really paid).
export const PLANS = {
  signals: { name: 'Signals', price: 15000, days: 30 },
  auto: { name: 'Signals + Auto-trading', price: 35000, days: 30 },
} as const
export type PlanId = keyof typeof PLANS
export const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`
