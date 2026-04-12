import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  db: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      basic: process.env.STRIPE_PRICE_BASIC,
      pro: process.env.STRIPE_PRICE_PRO,
      proplus: process.env.STRIPE_PRICE_PROPLUS,
    },
  },

  proxy: {
    brightdata: {
      zone: process.env.BRIGHTDATA_ZONE || 'residential',
      username: process.env.BRIGHTDATA_USERNAME,
      password: process.env.BRIGHTDATA_PASSWORD,
    },
    oxylabs: {
      username: process.env.OXYLABS_USERNAME,
      password: process.env.OXYLABS_PASSWORD,
    },
    smartproxy: {
      username: process.env.SMARTPROXY_USERNAME,
      password: process.env.SMARTPROXY_PASSWORD,
    },
    iproyal: {
      username: process.env.IPROYAL_USERNAME,
      password: process.env.IPROYAL_PASSWORD,
    },
  },

  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  },

  tradovate: {
    clientId: process.env.TRADOVATE_CLIENT_ID,
    clientSecret: process.env.TRADOVATE_CLIENT_SECRET,
    redirectUri: process.env.TRADOVATE_REDIRECT_URI || 'https://api-production-e175.up.railway.app/api/brokers/tradovate/callback',
    authUrl: 'https://trader.tradovate.com/oauth',
    demoExchangeUrl: 'https://demo.tradovateapi.com/auth/oauthtoken',
    liveExchangeUrl: 'https://live.tradovateapi.com/auth/oauthtoken',
  },
};
