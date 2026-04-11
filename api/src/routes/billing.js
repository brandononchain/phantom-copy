import { Router } from 'express';
import Stripe from 'stripe';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { authRequired } from '../middleware/auth.js';

const stripe = new Stripe(config.stripe.secretKey);
const router = Router();

// ── Get plans ─────────────────────────────────────────────────────────────────

router.get('/plans', (req, res) => {
  res.json({
    plans: [
      { id: 'basic', name: 'Basic', price: 39, features: ['5 follower accounts', '1 proxy provider', 'Email support'] },
      { id: 'pro', name: 'Pro', price: 69, features: ['Unlimited followers', 'All proxy providers', 'Priority support', 'Per-follower overrides'] },
      { id: 'proplus', name: 'Pro+', price: 89, features: ['Everything in Pro', 'Custom proxy pools', 'REST API access', 'Webhook integrations', 'SLA guarantee'] },
    ],
  });
});

// ── Create checkout session ───────────────────────────────────────────────────

router.post('/checkout', authRequired, async (req, res) => {
  const { plan } = req.body;
  const priceId = config.stripe.prices[plan];
  if (!priceId) return res.status(400).json({ error: 'Invalid plan' });

  const user = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  let customerId = user.rows[0]?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.rows[0].email, metadata: { userId: String(req.user.id) } });
    customerId = customer.id;
    await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${config.cors.origin}/profile?billing=success`,
    cancel_url: `${config.cors.origin}/profile?billing=cancelled`,
  });

  res.json({ url: session.url });
});

// ── Change plan (upgrade/downgrade) ───────────────────────────────────────────

router.post('/change-plan', authRequired, async (req, res) => {
  const { plan } = req.body;
  const priceId = config.stripe.prices[plan];
  if (!priceId) return res.status(400).json({ error: 'Invalid plan' });

  const user = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const subId = user.rows[0]?.stripe_subscription_id;

  if (!subId) return res.status(400).json({ error: 'No active subscription' });

  try {
    const subscription = await stripe.subscriptions.retrieve(subId);
    const updated = await stripe.subscriptions.update(subId, {
      items: [{ id: subscription.items.data[0].id, price: priceId }],
      proration_behavior: 'create_prorations',
    });

    await query('UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2', [plan, req.user.id]);

    res.json({ success: true, plan, subscription: updated.id });
  } catch (err) {
    res.status(500).json({ error: 'Plan change failed', message: err.message });
  }
});

// ── Get billing info ──────────────────────────────────────────────────────────

router.get('/info', authRequired, async (req, res) => {
  const user = await query('SELECT stripe_customer_id, stripe_subscription_id, plan FROM users WHERE id = $1', [req.user.id]);
  const u = user.rows[0];
  if (!u?.stripe_customer_id) return res.json({ plan: u?.plan || 'basic', subscription: null });

  try {
    const sub = u.stripe_subscription_id ? await stripe.subscriptions.retrieve(u.stripe_subscription_id) : null;
    const invoices = await stripe.invoices.list({ customer: u.stripe_customer_id, limit: 10 });

    res.json({
      plan: u.plan,
      subscription: sub ? {
        status: sub.status,
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      } : null,
      invoices: invoices.data.map(inv => ({
        id: inv.number,
        date: new Date(inv.created * 1000),
        amount: (inv.amount_paid / 100).toFixed(2),
        status: inv.status,
        pdf: inv.invoice_pdf,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch billing info' });
  }
});

// ── Stripe webhook ────────────────────────────────────────────────────────────

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;
      const subId = session.subscription;
      await query(
        'UPDATE users SET stripe_subscription_id = $1 WHERE stripe_customer_id = $2',
        [subId, customerId]
      );
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const priceId = sub.items.data[0]?.price.id;
      let plan = 'basic';
      if (priceId === config.stripe.prices.pro) plan = 'pro';
      else if (priceId === config.stripe.prices.proplus) plan = 'proplus';
      else if (priceId === config.stripe.prices.basic) plan = 'basic';

      await query(
        'UPDATE users SET plan = $1, updated_at = NOW() WHERE stripe_customer_id = $2',
        [plan, sub.customer]
      );
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await query(
        `UPDATE users SET plan = 'basic', stripe_subscription_id = NULL, updated_at = NOW()
         WHERE stripe_customer_id = $1`,
        [sub.customer]
      );
      break;
    }
  }

  res.json({ received: true });
});

export default router;
