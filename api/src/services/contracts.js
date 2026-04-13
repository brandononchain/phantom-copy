// ─────────────────────────────────────────────────────────────────────────────
// Tradevanish: Contract Resolution Service
// ─────────────────────────────────────────────────────────────────────────────
// Maps TradingView/generic ticker symbols to broker-specific contract IDs.
// Handles CME, COMEX, NYMEX, and ICE futures with proper roll dates.
// ─────────────────────────────────────────────────────────────────────────────

// Month codes: F=Jan G=Feb H=Mar J=Apr K=May M=Jun N=Jul Q=Aug U=Sep V=Oct X=Nov Z=Dec
const MONTH_CODES = ['F','G','H','J','K','M','N','Q','U','V','X','Z'];

// ── Contract specifications ──────────────────────────────────────────────────
// cycle: which months the contract trades (quarterly = H,M,U,Z)
// rollDaysBefore: how many calendar days before expiry to roll to next contract
// exchange: CME, COMEX, NYMEX

const CONTRACTS = {
  // ─── CME Equity Index Futures ───────────────────────────────────
  'ES':   { exchange: 'CME', name: 'E-mini S&P 500',           cycle: 'quarterly', tickSize: 0.25, tickValue: 12.50 },
  'NQ':   { exchange: 'CME', name: 'E-mini Nasdaq 100',        cycle: 'quarterly', tickSize: 0.25, tickValue: 5.00 },
  'YM':   { exchange: 'CME', name: 'E-mini Dow',               cycle: 'quarterly', tickSize: 1,    tickValue: 5.00 },
  'RTY':  { exchange: 'CME', name: 'E-mini Russell 2000',      cycle: 'quarterly', tickSize: 0.10, tickValue: 5.00 },
  'NKD':  { exchange: 'CME', name: 'Nikkei 225 Dollar',        cycle: 'quarterly', tickSize: 5,    tickValue: 25.00 },
  'NIY':  { exchange: 'CME', name: 'Nikkei 225 Yen',           cycle: 'quarterly', tickSize: 5,    tickValue: 500 },

  // ─── CME Micro Equity Index ─────────────────────────────────────
  'MES':  { exchange: 'CME', name: 'Micro E-mini S&P 500',     cycle: 'quarterly', tickSize: 0.25, tickValue: 1.25 },
  'MNQ':  { exchange: 'CME', name: 'Micro E-mini Nasdaq 100',  cycle: 'quarterly', tickSize: 0.25, tickValue: 0.50 },
  'MYM':  { exchange: 'CME', name: 'Micro E-mini Dow',         cycle: 'quarterly', tickSize: 1,    tickValue: 0.50 },
  'M2K':  { exchange: 'CME', name: 'Micro E-mini Russell',     cycle: 'quarterly', tickSize: 0.10, tickValue: 0.50 },

  // ─── CME FX Futures ─────────────────────────────────────────────
  '6E':   { exchange: 'CME', name: 'Euro FX',                  cycle: 'quarterly', tickSize: 0.00005, tickValue: 6.25 },
  '6J':   { exchange: 'CME', name: 'Japanese Yen',             cycle: 'quarterly', tickSize: 0.0000005, tickValue: 6.25 },
  '6B':   { exchange: 'CME', name: 'British Pound',            cycle: 'quarterly', tickSize: 0.0001, tickValue: 6.25 },
  '6A':   { exchange: 'CME', name: 'Australian Dollar',        cycle: 'quarterly', tickSize: 0.0001, tickValue: 10.00 },
  '6C':   { exchange: 'CME', name: 'Canadian Dollar',          cycle: 'quarterly', tickSize: 0.00005, tickValue: 5.00 },
  '6S':   { exchange: 'CME', name: 'Swiss Franc',              cycle: 'quarterly', tickSize: 0.0001, tickValue: 12.50 },
  '6N':   { exchange: 'CME', name: 'New Zealand Dollar',       cycle: 'quarterly', tickSize: 0.0001, tickValue: 10.00 },
  '6M':   { exchange: 'CME', name: 'Mexican Peso',             cycle: 'quarterly', tickSize: 0.000010, tickValue: 5.00 },

  // ─── CME Micro FX ──────────────────────────────────────────────
  'M6E':  { exchange: 'CME', name: 'Micro EUR/USD',            cycle: 'quarterly', tickSize: 0.0001, tickValue: 1.25 },
  'M6A':  { exchange: 'CME', name: 'Micro AUD/USD',            cycle: 'quarterly', tickSize: 0.0001, tickValue: 1.00 },
  'M6B':  { exchange: 'CME', name: 'Micro GBP/USD',            cycle: 'quarterly', tickSize: 0.0001, tickValue: 0.625 },

  // ─── CME Interest Rate ─────────────────────────────────────────
  'ZB':   { exchange: 'CME', name: 'US Treasury Bond',         cycle: 'quarterly', tickSize: 1/32, tickValue: 31.25 },
  'ZN':   { exchange: 'CME', name: '10-Year T-Note',           cycle: 'quarterly', tickSize: 1/64, tickValue: 15.625 },
  'ZF':   { exchange: 'CME', name: '5-Year T-Note',            cycle: 'quarterly', tickSize: 1/128, tickValue: 7.8125 },

  // ─── COMEX Metals ──────────────────────────────────────────────
  'GC':   { exchange: 'COMEX', name: 'Gold',                   cycle: 'bimonthly_even', tickSize: 0.10, tickValue: 10.00 },
  'SI':   { exchange: 'COMEX', name: 'Silver',                 cycle: 'monthly_active', tickSize: 0.005, tickValue: 25.00 },
  'HG':   { exchange: 'COMEX', name: 'Copper',                 cycle: 'monthly_active', tickSize: 0.0005, tickValue: 12.50 },
  'MGC':  { exchange: 'COMEX', name: 'Micro Gold',             cycle: 'bimonthly_even', tickSize: 0.10, tickValue: 1.00 },
  'SIL':  { exchange: 'COMEX', name: 'Micro Silver',           cycle: 'monthly_active', tickSize: 0.005, tickValue: 5.00 },

  // ─── NYMEX Energy ──────────────────────────────────────────────
  'CL':   { exchange: 'NYMEX', name: 'Crude Oil WTI',          cycle: 'monthly',   tickSize: 0.01, tickValue: 10.00 },
  'NG':   { exchange: 'NYMEX', name: 'Natural Gas',            cycle: 'monthly',   tickSize: 0.001, tickValue: 10.00 },
  'RB':   { exchange: 'NYMEX', name: 'RBOB Gasoline',          cycle: 'monthly',   tickSize: 0.0001, tickValue: 4.20 },
  'HO':   { exchange: 'NYMEX', name: 'Heating Oil',            cycle: 'monthly',   tickSize: 0.0001, tickValue: 4.20 },
  'MCL':  { exchange: 'NYMEX', name: 'Micro Crude Oil',        cycle: 'monthly',   tickSize: 0.01, tickValue: 1.00 },
  'MNG':  { exchange: 'NYMEX', name: 'Micro Natural Gas',      cycle: 'monthly',   tickSize: 0.001, tickValue: 1.00 },

  // ─── CME Ag ────────────────────────────────────────────────────
  'ZC':   { exchange: 'CME', name: 'Corn',                     cycle: 'ag_corn',   tickSize: 0.25, tickValue: 12.50 },
  'ZS':   { exchange: 'CME', name: 'Soybeans',                 cycle: 'ag_soy',    tickSize: 0.25, tickValue: 12.50 },
  'ZW':   { exchange: 'CME', name: 'Wheat',                    cycle: 'ag_wheat',  tickSize: 0.25, tickValue: 12.50 },
  'ZL':   { exchange: 'CME', name: 'Soybean Oil',              cycle: 'ag_soy',    tickSize: 0.01, tickValue: 6.00 },
  'ZM':   { exchange: 'CME', name: 'Soybean Meal',             cycle: 'ag_soy',    tickSize: 0.10, tickValue: 10.00 },
  'LE':   { exchange: 'CME', name: 'Live Cattle',              cycle: 'bimonthly_even', tickSize: 0.025, tickValue: 10.00 },
  'HE':   { exchange: 'CME', name: 'Lean Hogs',               cycle: 'bimonthly_even', tickSize: 0.025, tickValue: 10.00 },
};

// ── Cycle definitions ────────────────────────────────────────────────────────
const CYCLES = {
  quarterly:       [2, 5, 8, 11],       // H(Mar), M(Jun), U(Sep), Z(Dec) - 0-indexed
  monthly:         [0,1,2,3,4,5,6,7,8,9,10,11],
  bimonthly_even:  [1,3,5,7,9,11],      // G,J,M,Q,V,Z
  monthly_active:  [0,1,2,3,4,5,6,7,8,9,10,11],
  ag_corn:         [2,4,6,8,11],         // H,K,N,U,Z
  ag_soy:          [0,2,4,6,7,8,10],     // F,H,K,N,Q,U,X
  ag_wheat:        [2,4,6,8,11],         // H,K,N,U,Z
};

// ── Get the front month contract ─────────────────────────────────────────────
// Rolls to next contract 8 calendar days before the 3rd Friday of expiry month
// for equity index futures. For energy/metals, rolls ~3 business days before.

export function getFrontMonth(ticker, referenceDate = new Date()) {
  const spec = CONTRACTS[ticker];
  if (!spec) return null;

  const cycleKey = spec.cycle;
  const cycle = CYCLES[cycleKey] || CYCLES.quarterly;

  const now = referenceDate;
  const currentMonth = now.getMonth(); // 0-indexed
  const currentYear = now.getFullYear();
  const dayOfMonth = now.getDate();

  // Find the current or next contract month
  // Roll logic: switch to next contract 8 days before 3rd Friday of expiry month
  for (let offset = 0; offset < 24; offset++) {
    const checkMonth = (currentMonth + offset) % 12;
    const checkYear = currentYear + Math.floor((currentMonth + offset) / 12);

    if (!cycle.includes(checkMonth)) continue;

    // Calculate 3rd Friday of this month
    const firstDay = new Date(checkYear, checkMonth, 1).getDay();
    const firstFriday = firstDay <= 5 ? (5 - firstDay + 1) : (12 - firstDay + 1);
    const thirdFriday = firstFriday + 14;
    const rollDate = thirdFriday - 8; // Roll 8 calendar days before

    // If we're in the expiry month and past the roll date, skip to next
    if (offset === 0 && dayOfMonth >= rollDate) continue;

    return {
      month: checkMonth,
      year: checkYear,
      monthCode: MONTH_CODES[checkMonth],
      yearShort: checkYear % 100,
    };
  }

  // Fallback
  return { month: currentMonth, year: currentYear, monthCode: MONTH_CODES[currentMonth], yearShort: currentYear % 100 };
}

// ── Resolve to TopStepX contract ID ──────────────────────────────────────────
// Format: CON.F.US.{SYMBOL}.{MONTH_CODE}{YY}

export function toTopStepXContractId(ticker, referenceDate) {
  const fm = getFrontMonth(ticker, referenceDate);
  if (!fm) return ticker; // Unknown symbol, pass through
  return `CON.F.US.${ticker}.${fm.monthCode}${fm.yearShort}`;
}

// ── Resolve to Tradovate contract ID ─────────────────────────────────────────
// Format: {SYMBOL}{MONTH_CODE}{YY} e.g. ESH26, MNQM26

export function toTradovateContractId(ticker, referenceDate) {
  const fm = getFrontMonth(ticker, referenceDate);
  if (!fm) return ticker;
  return `${ticker}${fm.monthCode}${fm.yearShort}`;
}

// ── Resolve for any platform ─────────────────────────────────────────────────

export function resolveContractId(ticker, platform, referenceDate) {
  if (platform === 'topstepx') return toTopStepXContractId(ticker, referenceDate);
  if (platform === 'tradovate' || platform === 'ninjatrader') return toTradovateContractId(ticker, referenceDate);
  return ticker; // Rithmic uses raw symbol
}

// ── Normalize ticker from various sources ────────────────────────────────────
// TradingView sends: NQ1!, ESZ2026, MNQM2026, NQ, ES
// We need: NQ, ES, MNQ

export function normalizeTicker(raw) {
  if (!raw) return null;
  let t = raw.toUpperCase().trim();

  // Strip continuous contract markers: NQ1! -> NQ
  t = t.replace(/[0-9]*!$/, '');

  // Strip full year contract: ESZ2026 -> ES, MNQM2026 -> MNQ
  // Match symbol + single month code + 4-digit year
  const fullYear = t.match(/^([A-Z0-9]+)([FGHJKMNQUVXZ])(\d{4})$/);
  if (fullYear) return fullYear[1];

  // Strip short year contract: ESH26 -> ES
  const shortYear = t.match(/^([A-Z0-9]+)([FGHJKMNQUVXZ])(\d{2})$/);
  if (shortYear) return shortYear[1];

  // Strip exchange prefix: CME_MINI:NQ1! -> NQ
  if (t.includes(':')) t = t.split(':').pop();
  t = t.replace(/[0-9]*!$/, '');

  return t;
}

// ── Get contract info ────────────────────────────────────────────────────────

export function getContractInfo(ticker) {
  return CONTRACTS[normalizeTicker(ticker)] || null;
}

// ── List all supported symbols ───────────────────────────────────────────────

export function getAllSymbols() {
  return Object.entries(CONTRACTS).map(([symbol, spec]) => ({
    symbol, ...spec,
  }));
}
