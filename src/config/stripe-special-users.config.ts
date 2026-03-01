import * as fs from 'fs';
import * as path from 'path';

// Helper to parse env file manually to avoid dependency issues if dotenv is not direct dep
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const result: Record<string, string> = {};
    const lines = content.split('\n');
    for (const line of lines) {
      // Simple parsing: KEY=VALUE, ignoring comments #
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        // Remove quotes if present
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        result[key] = val;
      }
    }
    return result;
  } catch (e) {
    console.warn(`Failed to load special env file: ${filePath}`, e);
    return {};
  }
}

// Try to find .env.dev in multiple locations
function findEnvDevFile(): string {
  const possiblePaths = [
    // Relative to this config file (src/config -> project root)
    path.resolve(__dirname, '../../.env.dev'),
    // From project root via cwd
    path.resolve(process.cwd(), '.env.dev'),
    // In case server runs from project root
    path.resolve(process.cwd(), 'server/.env.dev'),
    // Dist folder case (dist/config -> project root)  
    path.resolve(__dirname, '../../../.env.dev'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`[stripe-special-users] Found .env.dev at: ${p}`);
      return p;
    }
  }
  
  console.warn(`[stripe-special-users] .env.dev not found in any of: ${possiblePaths.join(', ')}`);
  return possiblePaths[0]; // Return first path anyway, parseEnvFile will handle the error
}

const envDevPath = findEnvDevFile();
const devConfig = parseEnvFile(envDevPath);

const specialUsers = (devConfig.STRIPE_SPECIAL_USERS || '').split(',').filter(Boolean);

export const stripeSpecialUsersConfig = specialUsers.reduce((acc, email) => {
  acc[email] = {
    secretKey: devConfig.STRIPE_SECRET_KEY,
    publishableKey: devConfig.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    webhookSecret: devConfig.STRIPE_WEBHOOK_SECRET,
    
    // Price IDs
    tiktokStarterMonthlyPriceId: devConfig.STRIPE_TIKTOK_STARTER_MONTHLY_PRICE_ID,
    tiktokStarterAnnualPriceId: devConfig.STRIPE_TIKTOK_STARTER_ANNUAL_PRICE_ID,
    tiktokProMonthlyPriceId: devConfig.STRIPE_TIKTOK_PRO_MONTHLY_PRICE_ID,
    tiktokProAnnualPriceId: devConfig.STRIPE_TIKTOK_PRO_ANNUAL_PRICE_ID,

    // Google Ads Price IDs
    googleAdsStarterMonthlyPriceId: devConfig.STRIPE_GOOGLE_ADS_STARTER_MONTHLY_PRICE_ID,
    googleAdsStarterAnnualPriceId: devConfig.STRIPE_GOOGLE_ADS_STARTER_ANNUAL_PRICE_ID,
    googleAdsProMonthlyPriceId: devConfig.STRIPE_GOOGLE_ADS_PRO_MONTHLY_PRICE_ID,
    googleAdsProAnnualPriceId: devConfig.STRIPE_GOOGLE_ADS_PRO_ANNUAL_PRICE_ID,
    
    organizationBasicMonthlyPriceId: devConfig.STRIPE_ORGANIZATION_BASIC_MONTHLY_PRICE_ID,
    organizationBasicAnnualPriceId: devConfig.STRIPE_ORGANIZATION_BASIC_ANNUAL_PRICE_ID,
    organizationProMonthlyPriceId: devConfig.STRIPE_ORGANIZATION_PRO_MONTHLY_PRICE_ID,
    organizationProAnnualPriceId: devConfig.STRIPE_ORGANIZATION_PRO_ANNUAL_PRICE_ID,
  };
  return acc;
}, {} as Record<string, any>);
