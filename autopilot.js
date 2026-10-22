import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { fetchRealBscUsdtPayouts, formatDateTime, maskWalletAddress, generateRealisticMaskedUsername } from './analyzer.js';
import { formatChannelProofPost } from './formatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'autopilot_config.json');
const STATS_FILE = path.join(__dirname, 'stats.json');

// Default Autopilot Config
const defaultConfig = {
  enabled: true,         // Auto-post enabled by default
  intervalMinutes: 1,    // Post cycle interval in minutes (e.g. 1 min or 2 mins)
  proofsPerCycle: 2,     // 2 real proofs per minute as requested
  minAmount: 0.1,        // Minimum USDT amount (never below 0.1$)
  maxAmount: 1.0         // Maximum USDT amount (never above 1.0$)
};

let currentConfig = { ...defaultConfig };

// Load config from disk
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      currentConfig = { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
    }
  } catch (err) {
    console.error('Error loading autopilot config:', err);
  }
  return currentConfig;
}

// Save config to disk
export function saveConfig(newConfig) {
  currentConfig = { ...currentConfig, ...newConfig };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving autopilot config:', err);
  }
  return currentConfig;
}

// Update stats
function recordStats(amount, token = 'USDT') {
  try {
    let stats = { totalProofs: 0, totalUsdt: 0, totalBnb: 0, lastPostTime: null };
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    }
    stats.totalProofs = (stats.totalProofs || 0) + 1;
    const num = parseFloat(String(amount).replace(/,/g, '')) || 0;
    stats.totalUsdt = (stats.totalUsdt || 0) + num;
    stats.lastPostTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }) + ' (UTC+6)';
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving stats:', err);
  }
}

let timer = null;
let telegramBot = null;
let isCycleRunning = false;

/**
 * Execute one cycle of fetching and sharing 3 to 4 real BSC proofs
 */
export async function runProofCycle(telegram, requestedCount = null) {
  if (isCycleRunning) {
    console.log('⏳ A proof cycle is already running, skipping overlapping cycle.');
    return { success: false, reason: 'Already running' };
  }

  isCycleRunning = true;
  const cfg = loadConfig();
  const count = requestedCount || cfg.proofsPerCycle || 3;

  console.log(`\n🔍 [AUTOPILOT] Analyzing BSC blockchain for ${count} real USDT payouts...`);

  try {
    const realPayouts = await fetchRealBscUsdtPayouts(count, cfg.minAmount, cfg.maxAmount);

    if (!realPayouts || realPayouts.length === 0) {
      console.log('⚠️ [AUTOPILOT] No matching USDT payouts found in the last few blocks, will retry next cycle.');
      isCycleRunning = false;
      return { success: false, count: 0 };
    }

    console.log(`✅ [AUTOPILOT] Found ${realPayouts.length} verified on-chain payouts! Broadcasting to ${config.channelUsername}...`);

    let postedCount = 0;
    for (let i = 0; i < realPayouts.length; i++) {
      const payout = realPayouts[i];
      const messageText = formatChannelProofPost(payout);

      try {
        await telegram.sendMessage(config.channelUsername, messageText, {
          parse_mode: 'HTML',
          link_preview_options: {
            is_disabled: false // Enables BscScan rich preview box with QR code!
          }
        });

        postedCount++;
        recordStats(payout.amount, 'USDT');
        console.log(`📢 [${i + 1}/${realPayouts.length}] Posted proof: ${payout.amount} USDT (Tx: ${payout.txHash.slice(0, 10)}...)`);

        // Wait 6 seconds between posts for natural appearance
        if (i < realPayouts.length - 1) {
          await new Promise(res => setTimeout(res, 6000));
        }
      } catch (postErr) {
        console.error(`❌ Failed to post proof ${i + 1} to channel:`, postErr.message);
        if (postErr.message.includes('chat not found') || postErr.message.includes('Forbidden')) {
          console.error('👉 Make sure the bot is an Administrator in ' + config.channelUsername + ' with Post Messages permission!');
        }
      }
    }

    isCycleRunning = false;
    return { success: true, count: postedCount };
  } catch (err) {
    console.error('❌ Error during runProofCycle:', err);
    isCycleRunning = false;
    return { success: false, error: err.message };
  }
}

/**
 * Start the Autopilot Scheduler
 */
export function startAutoPilot(telegram) {
  telegramBot = telegram;
  loadConfig();

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  saveConfig({ enabled: true });
  console.log(`🚀 [AUTOPILOT] Started! Posting ${currentConfig.proofsPerCycle} real proofs every ${currentConfig.intervalMinutes} minute(s).`);

  // Run first cycle shortly after starting (after 5 seconds)
  setTimeout(() => {
    if (currentConfig.enabled && telegramBot) {
      runProofCycle(telegramBot).catch(console.error);
    }
  }, 5000);

  // Set recurring interval
  const intervalMs = Math.max(1, currentConfig.intervalMinutes) * 60 * 1000;
  timer = setInterval(() => {
    if (currentConfig.enabled && telegramBot) {
      runProofCycle(telegramBot).catch(console.error);
    }
  }, intervalMs);
}

/**
 * Stop the Autopilot Scheduler
 */
export function stopAutoPilot() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  saveConfig({ enabled: false });
  console.log('⏸️ [AUTOPILOT] Stopped.');
}

/**
 * Get current Autopilot status
 */
export function getAutoPilotStatus() {
  const cfg = loadConfig();
  return {
    ...cfg,
    isRunning: Boolean(timer) && cfg.enabled
  };
}
