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

// ── Expiry model per product family ──────────────────────────────────────────
// Different products expire on very different schedules, and energy/metals stop
// trading in the month BEFORE the delivery (contract) month. Emitting the wrong
// month gets the order rejected near roll, so we approximate each family's last
// trade date (good to a few days — the roll buffer absorbs the rest).

function thirdFriday(year, monthIdx) {
  const firstDow = new Date(year, monthIdx, 1).getDay();
  const firstFri = firstDow <= 5 ? (5 - firstDow + 1) : (12 - firstDow + 1);
  return new Date(year, monthIdx, firstFri + 14);
}

// A calendar day in the contract month (monthDelta 0) or a neighbouring month
// (e.g. -1 for energy/metals that expire the month before). Date normalizes
// month/day overflow, including across year boundaries.
function dayInMonth(year, monthIdx, monthDelta, day) {
  return new Date(year, monthIdx + monthDelta, day);
}

// Which expiry rule applies to a contract, derived from its exchange/cycle.
function expiryRuleFor(ticker, spec) {
  if (spec.exchange === 'COMEX') return 'metal_eom';                    // GC/SI/HG + micros: first notice ~ last bd of prior month
  if (spec.exchange === 'NYMEX') return (ticker === 'CL' || ticker === 'MCL') ? 'energy_cl' : 'energy_prior'; // CL vs NG/RB/HO
  if (spec.cycle === 'ag_corn' || spec.cycle === 'ag_soy' || spec.cycle === 'ag_wheat') return 'ag_mid';
  if (ticker === 'LE' || ticker === 'HE') return 'livestock';          // expire near end of contract month
  return 'friday3';                                                     // equity index, FX, rates (quarterly)
}

// Approximate last-trade date for a contract labelled (year, monthIdx).
function expiryDate(rule, year, monthIdx) {
  switch (rule) {
    case 'friday3':      return thirdFriday(year, monthIdx);
    case 'ag_mid':       return dayInMonth(year, monthIdx, 0, 14);   // ~ business day before the 15th
    case 'livestock':    return dayInMonth(year, monthIdx, 0, 28);   // ~ last business day of contract month
    case 'energy_cl':    return dayInMonth(year, monthIdx, -1, 20);  // CL: ~3 bd before the 25th of the prior month
    case 'energy_prior': return dayInMonth(year, monthIdx, -1, 26);  // NG/RB/HO: last trade in the prior month
    case 'metal_eom':    return dayInMonth(year, monthIdx, -1, 27);  // metals: first notice ~ last bd of prior month
    default:             return thirdFriday(year, monthIdx);
  }
}

// ── Get the front month contract ─────────────────────────────────────────────
// Returns the first contract in the product's cycle whose roll date is still in
// the future, using the product-specific expiry above (not equity timing for all).

export function getFrontMonth(ticker, referenceDate = new Date()) {
  const spec = CONTRACTS[ticker];
  if (!spec) return null;

  const cycle = CYCLES[spec.cycle] || CYCLES.quarterly;
  const rule = expiryRuleFor(ticker, spec);
  const rollDays = rule === 'friday3' ? 8 : 5; // roll this many calendar days before expiry

  const now = referenceDate;
  const cM = now.getMonth();
  const cY = now.getFullYear();

  for (let offset = 0; offset < 24; offset++) {
    const m = (cM + offset) % 12;
    const y = cY + Math.floor((cM + offset) / 12);
    if (!cycle.includes(m)) continue;

    const rollBy = expiryDate(rule, y, m);
    rollBy.setDate(rollBy.getDate() - rollDays);
    if (now < rollBy) {
      return { month: m, year: y, monthCode: MONTH_CODES[m], yearShort: y % 100 };
    }
  }

  // Fallback (should not happen within a 24-month horizon)
  return { month: cM, year: cY, monthCode: MONTH_CODES[cM], yearShort: cY % 100 };
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

  // Strip exchange prefix first so dated/continuous forms behind a prefix still
  // normalize: CME_MINI:ESZ2026 -> ESZ2026, CME_MINI:NQ1! -> NQ1!
  if (t.includes(':')) t = t.split(':').pop();

  // Strip continuous contract markers: NQ1! -> NQ
  t = t.replace(/[0-9]*!$/, '');

  // Strip full year contract: ESZ2026 -> ES, MNQM2026 -> MNQ
  // Match symbol + single month code + 4-digit year
  const fullYear = t.match(/^([A-Z0-9]+)([FGHJKMNQUVXZ])(\d{4})$/);
  if (fullYear) return fullYear[1];

  // Strip short year contract: ESH26 -> ES
  const shortYear = t.match(/^([A-Z0-9]+)([FGHJKMNQUVXZ])(\d{2})$/);
  if (shortYear) return shortYear[1];

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
