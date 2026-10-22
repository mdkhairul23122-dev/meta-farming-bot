import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FUND_FILE = path.join(__dirname, 'fund_state.json');

/**
 * Get current remaining All Fund
 */
export function getCurrentFund() {
  try {
    if (fs.existsSync(FUND_FILE)) {
      const data = JSON.parse(fs.readFileSync(FUND_FILE, 'utf-8'));
      if (typeof data.currentFund === 'number' && !isNaN(data.currentFund)) {
        return data.currentFund;
      }
    }
  } catch (err) {
    // fallback
  }
  return 1000.0000;
}

/**
 * Deduct an amount from All Fund on every successful transaction post
 */
export function deductFund(amount) {
  let fund = getCurrentFund();
  const num = parseFloat(String(amount).replace(/,/g, '')) || 0;
  fund = fund - num;

  // If fund ever goes below 10$, auto-replenish with 1000$ so it stays realistic
  if (fund < 10) {
    fund += 1000.0000;
  }

  try {
    fs.writeFileSync(FUND_FILE, JSON.stringify({
      currentFund: fund,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving fund state:', err);
  }

  return fund;
}

/**
 * Set All Fund explicitly (e.g. analyzed from channel post)
 */
export function setFund(newFund) {
  if (typeof newFund === 'number' && !isNaN(newFund) && newFund > 0) {
    try {
      fs.writeFileSync(FUND_FILE, JSON.stringify({
        currentFund: newFund,
        updatedAt: new Date().toISOString()
      }, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error syncing fund state:', err);
    }
  }
}

/**
 * Format channel payment proof EXACTLY matching the user's requested design
 */
export function formatChannelProofPost(data) {
  const projectBotHandle = config.projectBotUsername || 'Meta_Farming_bot';
  const amountStr = typeof data.amount === 'number' 
    ? data.amount.toFixed(4) 
    : (parseFloat(data.amount) ? parseFloat(data.amount).toFixed(4) : data.amount);

  const fundNum = data.allFund !== undefined 
    ? (typeof data.allFund === 'number' ? data.allFund : parseFloat(data.allFund))
    : getCurrentFund();
  const allFundStr = (fundNum && !isNaN(fundNum)) ? fundNum.toFixed(4) : '1000.0000';

  return `💎 𝐌𝐄𝐓𝐀 𝐅𝐀𝐑𝐌𝐈𝐍𝐆
━━━━━━━━━━━━━━━━━━━━━━
✦ 𝐏𝐀𝐘𝐌𝐄𝐍𝐓 𝐑𝐄𝐂𝐄𝐈𝐏𝐓 ✦ 💚 ${amountStr} USDT ✓ Withdrawal Processed
━━━━━━━━━━━━━━━━━━━━━━
👤 𝐑𝐄𝐂𝐈𝐏𝐈𝐄𝐍𝐓
${data.maskedUsername}
💳 𝐏𝐀𝐘𝐌𝐄𝐍𝐓 𝐃𝐄𝐓𝐀𝐈𝐋𝐒
◈ Amount ${amountStr} USDT
◈ Network BNB Smart Chain
◈ Protocol BEP-20
◈ Date ${data.dateStr}
◈ All Fund ${allFundStr} USDT
━━━━━━━━━━━━━━━━━━━━━━
📤 𝐅𝐑𝐎𝐌
${data.maskedFrom}
📥 𝐓𝐎
${data.maskedTo}
━━━━━━━━━━━━━━━━━━━━━━
🔎 𝐎𝐍-𝐂𝐇𝐀𝐈𝐍 𝐕𝐄𝐑𝐈𝐅𝐈𝐂𝐀𝐓𝐈𝐎𝐍
<a href="https://bscscan.com/tx/${data.txHash}">View Transaction on BscScan</a>
━━━━━━━━━━━━━━━━━━━━━━
💠 𝐌𝐄𝐓𝐀 𝐅𝐀𝐑𝐌𝐈𝐍𝐆
Your Rewards. Your Progress.
🤖 @${projectBotHandle}`;
}

/**
 * Preview buttons for Admin
 */
export function getAdminPreviewButtons() {
  return {
    inline_keyboard: [
      [
        { text: '📢 Confirm & Post to Channel', callback_data: 'confirm_post' }
      ],
      [
        { text: '❌ Cancel', callback_data: 'cancel_post' }
      ]
    ]
  };
}
