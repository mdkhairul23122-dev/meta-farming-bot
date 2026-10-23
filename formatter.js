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
 * Format channel payment proof EXACTLY matching the user's requested DollarNest design
 */
export function formatChannelProofPost(data) {
  const amountStr = typeof data.amount === 'number' 
    ? data.amount.toFixed(4) 
    : (parseFloat(data.amount) ? parseFloat(data.amount).toFixed(4) : data.amount);

  const fundNum = data.allFund !== undefined 
    ? (typeof data.allFund === 'number' ? data.allFund : parseFloat(data.allFund))
    : getCurrentFund();
  const allFundStr = (fundNum && !isNaN(fundNum)) ? fundNum.toFixed(4) : '956.4794';

  const username = data.maskedUsername || '@sk***10';
  const fromAddr = data.maskedFrom || '0xf0f6...e3c4';
  const toAddr = data.maskedTo || '0x6f4f...9383';

  return `💎 DOLLARNEST | FUNDING WALLET 💎
━━━━━━━━━━━━━━━━━━━━
👤 Username: ${username}
📤 Transaction Details
💵 Amount: ${amountStr} USDT
📥 From: ${fromAddr}
📤 Send To: ${toAddr}
🌐 Network: Binance Smart Chain (BEP-20)
━━━━━━━━━━━━━━━━━━━━
◈ All Fund ${allFundStr} USDT
✅ Status: Funds Available `;
}

/**
 * 2 Link Buttons at bottom of channel post:
 * 1. Official Bot
 * 2. Bsc Transaction (BscScan URL)
 */
export function getChannelProofButtons(txHash) {
  const officialBotUrl = config.officialBotLink 
    || (config.projectBotUsername ? `https://t.me/${config.projectBotUsername.replace('@', '')}` : 'https://t.me/Meta_Farming_bot');
  const bscScanUrl = `https://bscscan.com/tx/${txHash}`;

  return {
    inline_keyboard: [
      [
        { text: 'Official Bot', url: officialBotUrl },
        { text: 'Bsc Transaction', url: bscScanUrl }
      ]
    ]
  };
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
