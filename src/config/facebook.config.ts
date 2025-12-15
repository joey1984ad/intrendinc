import { registerAs } from '@nestjs/config';

export const facebookConfig = registerAs('facebook', () => ({
  appId: process.env.FACEBOOK_APP_ID,
  appSecret: process.env.FACEBOOK_APP_SECRET,
  accessToken: process.env.FACEBOOK_ACCESS_TOKEN,
  graphApiVersion: process.env.FACEBOOK_GRAPH_API_VERSION || 'v21.0',
}));
