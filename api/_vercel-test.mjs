// Test settings save via Vercel proxy (how the real dashboard works)
const API_DIRECT = 'https://api-production-e175.up.railway.app/api';
const API_VERCEL = 'https://www.tradevanish.com/api';

const ts = Date.now();
const reg = await fetch(`${API_DIRECT}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `vtest${ts}@t.com`, password: 'Pass123!', name: 'Vercel Proxy Test' }),
});
const { token } = await reg.json();
console.log('1. Registered, got token:', !!token);

// Test through Vercel proxy
const auth = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

console.log('\n2. GET settings via Vercel proxy...');
const g1 = await fetch(`${API_VERCEL}/settings/risk`, { headers: auth });
console.log('   Status:', g1.status);
const g1d = await g1.json();
console.log('   copy_symbols:', g1d.rules?.copy_symbols, '| max_qty:', g1d.rules?.max_qty);

console.log('\n3. PUT settings via Vercel proxy (copy_symbols=TEST, max_qty=77)...');
const p = await fetch(`${API_VERCEL}/settings/risk`, {
  method: 'PUT',
  headers: auth,
  body: JSON.stringify({ copy_symbols: 'TEST', max_qty: 77, copy_brackets: false }),
});
console.log('   Status:', p.status);
const pd = await p.json();
console.log('   Saved copy_symbols:', pd.rules?.copy_symbols, '| max_qty:', pd.rules?.max_qty, '| brackets:', pd.rules?.copy_brackets);

console.log('\n4. GET settings via Vercel proxy (verify persistence)...');
const g2 = await fetch(`${API_VERCEL}/settings/risk`, { headers: auth });
const g2d = await g2.json();
console.log('   Read back copy_symbols:', g2d.rules?.copy_symbols, '| max_qty:', g2d.rules?.max_qty, '| brackets:', g2d.rules?.copy_brackets);

const match = g2d.rules?.copy_symbols === 'TEST' && g2d.rules?.max_qty === 77;
console.log('\n5. SETTINGS PERSIST:', match ? '✓ YES' : '✗ NO — BUG!');
