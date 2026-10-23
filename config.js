import dotenv from 'dotenv';
dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN || '8993145804:AAErKf3auO8zyikeDjNNY-fCT0IY5d7K06o',
  adminIds: (process.env.ADMIN_IDS || '8133346948')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean),
  channelUsername: process.env.CHANNEL_USERNAME || '@Meta_Farming_Payment_Proof',
  channelLink: process.env.CHANNEL_LINK || 'https://t.me/Meta_Farming_Payment_Proof',
  projectLink: process.env.PROJECT_LINK || 'https://t.me/Meta_Farming_Payment_Proof',
  botUsername: process.env.BOT_USERNAME || 'meta_farming_pement_bot',
  projectBotUsername: process.env.PROJECT_BOT_USERNAME || 'Meta_Farming_bot',
  officialBotLink: process.env.OFFICIAL_BOT_LINK || (process.env.PROJECT_BOT_USERNAME ? `https://t.me/${process.env.PROJECT_BOT_USERNAME.replace('@', '')}` : 'https://t.me/Meta_Farming_bot'),
  bscRpcUrls: (process.env.BSC_RPC_URLS || 'https://bsc-dataseed.binance.org/,https://binance.llamarpc.com,https://bsc-rpc.publicnode.com')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean),
};

export function isAdmin(userId) {
  if (!userId) return false;
  return config.adminIds.includes(String(userId));
}
