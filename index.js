import http from 'http';
import { createBot } from './bot.js';
import { config } from './config.js';
import { startAutoPilot, getAutoPilotStatus } from './autopilot.js';

// HTTP Health Check server for Cloud Platforms (Render, Railway, Koyeb)
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Meta Farming Payment Proof Bot is Running 24/7!\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️ Port ${port} is in use (health server skipped, bot continues running).`);
  } else {
    console.error('⚠️ HTTP Server error:', err.message);
  }
});

server.listen(port, () => {
  console.log(`🌐 Web health server active on port ${port}`);
});

// Prevent unhandled errors from terminating the bot
process.on('uncaughtException', (err) => {
  console.error('⚠️ Caught unhandled exception:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Caught unhandled rejection:', reason?.message || reason);
});

async function main() {
  console.log('🌾 ====================================================');
  console.log('🌾  Meta Farming Payment Proof Auto-Pilot Telegram Bot');
  console.log('🌾 ====================================================');

  if (!config.botToken) {
    console.error('❌ Error: BOT_TOKEN is missing in .env file!');
    process.exit(1);
  }

  const bot = createBot();

  try {
    const botInfo = await bot.telegram.getMe();
    config.botUsername = botInfo.username;

    console.log(`🤖 Bot connected: @${botInfo.username} (${botInfo.first_name})`);
    console.log(`🛡️ Authorized Admin ID: ${config.adminIds.join(', ')}`);
    console.log(`📢 Target Channel: ${config.channelUsername}`);
    console.log(`🔗 Channel Link: ${config.channelLink}`);
    console.log('🌐 Connected to Binance Smart Chain (BSC)');
    console.log('----------------------------------------------------');

    // Launch Telegraf polling
    bot.launch().catch(err => {
      console.error('Bot launch polling error:', err.message);
    });

    console.log('🚀 Bot polling active! Listening for admin commands...');

    // Check autopilot status and start
    const ap = getAutoPilotStatus();
    if (ap.enabled) {
      console.log(`⚡ Auto-Pilot is ENABLED: Will post ${ap.proofsPerCycle} real proofs every ${ap.intervalMinutes} min.`);
      startAutoPilot(bot.telegram);
    } else {
      console.log('⏸️ Auto-Pilot is currently PAUSED. Start it from Telegram menu.');
    }

    console.log('----------------------------------------------------');
  } catch (err) {
    console.error('❌ Failed to connect to Telegram:', err.message);
    if (err.message.includes('401')) {
      console.error('👉 Please check your BOT_TOKEN in .env');
    }
  }

  // Graceful shutdown
  process.once('SIGINT', () => {
    console.log('\n🛑 Stopping bot gracefully (SIGINT)...');
    bot.stop('SIGINT');
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    console.log('\n🛑 Stopping bot gracefully (SIGTERM)...');
    bot.stop('SIGTERM');
    process.exit(0);
  });
}

main().catch(console.error);
