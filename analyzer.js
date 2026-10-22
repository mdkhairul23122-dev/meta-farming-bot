import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POSTED_TXS_FILE = path.join(__dirname, 'posted_txs.json');

// USDT Contract on Binance Smart Chain
const USDT_CONTRACT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const iface = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);

// Set of posted transaction hashes to prevent any duplicates
let postedTxsSet = new Set();
try {
  if (fs.existsSync(POSTED_TXS_FILE)) {
    const data = JSON.parse(fs.readFileSync(POSTED_TXS_FILE, 'utf-8'));
    postedTxsSet = new Set(data);
  }
} catch (err) {
  console.error('Error loading posted txs:', err);
}

function savePostedTxs() {
  try {
    // Keep max 5000 recent txs
    const arr = Array.from(postedTxsSet);
    if (arr.length > 5000) {
      arr.splice(0, arr.length - 5000);
      postedTxsSet = new Set(arr);
    }
    fs.writeFileSync(POSTED_TXS_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving posted txs:', err);
  }
}

/**
 * Mask wallet address: 0x8bc0...b689
 */
export function maskWalletAddress(address) {
  if (!address) return '0x0000...0000';
  const clean = address.toLowerCase();
  if (clean.length < 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

/**
 * Generate realistic masked username e.g. @mr**im, @cr**7, @al**7, @sh**ik
 */
const USERNAME_PREFIXES = [
  'mr', 'cr', 'al', 'md', 'ta', 'sh', 'fa', 'su', 'ka', 'ra',
  'sa', 'ro', 'ar', 'ha', 'em', 'za', 'na', 'sk', 'no', 'lu',
  'ki', 'pr', 'am', 'so', 'ri', 'me', 'ab', 'mo', 'da', 'vi'
];
const USERNAME_SUFFIXES = [
  'im', '7', '99', 'ik', 'ul', 'on', 'em', 'an', 'id', '01',
  'va', 'ky', 'ng', 'ro', 'ir', 'ad', 'ar', 'ur', 'er', 'el',
  '88', '21', '07', '10', '9', 'vip', 'pro', 'in', 'ex', 'op'
];

export function generateRealisticMaskedUsername() {
  const prefix = USERNAME_PREFIXES[Math.floor(Math.random() * USERNAME_PREFIXES.length)];
  const suffix = USERNAME_SUFFIXES[Math.floor(Math.random() * USERNAME_SUFFIXES.length)];
  return `@${prefix}**${suffix}`;
}

/**
 * Format timestamp into Date: 22 Oct 2026
 */
export function formatReceiptDate(timestampSec) {
  const d = timestampSec ? new Date(timestampSec * 1000) : new Date();
  const day = d.getUTCDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function formatDateTime(timestampSec) {
  const dateStr = formatReceiptDate(timestampSec);
  const d = timestampSec ? new Date(timestampSec * 1000) : new Date();
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  return { dateStr, timeStr };
}

/**
 * Get resilient provider
 */
async function getWorkingProvider() {
  const urls = [
    'https://bsc-rpc.publicnode.com',
    'https://binance.llamarpc.com',
    'https://bsc-dataseed.binance.org/',
    'https://1rpc.io/bnb'
  ];

  for (const url of urls) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await Promise.race([
        p.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);
      return p;
    } catch (e) {
      // try next
    }
  }
  return new ethers.JsonRpcProvider(urls[0]);
}

/**
 * Analyze BSC blockchain and fetch real confirmed USDT payouts
 * @param {number} count Number of payouts to return (e.g. 3 or 4)
 * @param {number} minUsdt Minimum payout amount
 * @param {number} maxUsdt Maximum payout amount
 */
export async function fetchRealBscUsdtPayouts(count = 2, minUsdt = 0.1, maxUsdt = 1.0) {
  const provider = await getWorkingProvider();
  const currentBlock = await provider.getBlockNumber();

  // Scan last 5 blocks to have a rich pool of retail transactions
  const fromBlock = currentBlock - 4;
  const toBlock = currentBlock;

  let logs = [];
  try {
    logs = await provider.getLogs({
      address: USDT_CONTRACT_ADDRESS,
      topics: [TRANSFER_TOPIC],
      fromBlock,
      toBlock
    });
  } catch (err) {
    console.error('getLogs error on first provider, trying fallback block-by-block:', err.message);
    try {
      logs = await provider.getLogs({
        address: USDT_CONTRACT_ADDRESS,
        topics: [TRANSFER_TOPIC],
        fromBlock: currentBlock - 2,
        toBlock: currentBlock
      });
    } catch (e2) {
      console.error('Fallback getLogs also failed:', e2.message);
      return [];
    }
  }

  const preferredCandidates = []; // 0.1$ to 0.5$ (High Priority)
  const secondaryCandidates = []; // 0.5$ to 1.0$ (Secondary if needed)

  for (const log of logs) {
    const txHash = log.transactionHash;

    // Skip if already posted previously
    if (postedTxsSet.has(txHash.toLowerCase())) {
      continue;
    }

    try {
      const parsed = iface.parseLog(log);
      const rawVal = parsed.args[2];
      const numAmount = parseFloat(ethers.formatUnits(rawVal, 18));

      // Strict enforcement: Never < minUsdt (0.1) and never > maxUsdt (1.0)
      if (numAmount >= minUsdt && numAmount <= maxUsdt) {
        const item = {
          log,
          numAmount,
          txHash,
          fromAddr: parsed.args[0],
          toAddr: parsed.args[1]
        };

        // Prioritize 0.1$ to 0.5$
        if (numAmount <= 0.5) {
          preferredCandidates.push(item);
        } else {
          secondaryCandidates.push(item);
        }
      }
    } catch (err) {
      // Ignore individual parse errors
    }
  }

  // Shuffle both sets for natural randomness
  preferredCandidates.sort(() => 0.5 - Math.random());
  secondaryCandidates.sort(() => 0.5 - Math.random());

  // Prioritize 0.1$ - 0.5$ first, fill remaining slots with up to 1.0$
  const candidatePool = [...preferredCandidates, ...secondaryCandidates];
  const selected = candidatePool.slice(0, count);

  const results = [];
  const nowTs = Math.floor(Date.now() / 1000);

  for (const item of selected) {
    const formattedAmount = item.numAmount.toFixed(4);
    const dateStr = formatReceiptDate(nowTs);

    results.push({
      txHash: item.txHash,
      from: item.fromAddr,
      to: item.toAddr,
      maskedFrom: maskWalletAddress(item.fromAddr),
      maskedTo: maskWalletAddress(item.toAddr),
      amount: formattedAmount,
      token: 'USDT',
      maskedUsername: generateRealisticMaskedUsername(),
      dateStr,
      timestamp: nowTs
    });

    // Mark as posted
    postedTxsSet.add(item.txHash.toLowerCase());
  }

  if (results.length > 0) {
    savePostedTxs();
  }

  return results;
}
