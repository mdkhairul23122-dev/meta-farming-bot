import { ethers } from 'ethers';
import { config } from './config.js';

// Known popular BSC BEP-20 Tokens
const KNOWN_TOKENS = {
  '0x55d398326f99059ff775485246999027b3197955': { symbol: 'USDT', decimals: 18, name: 'Tether USD' },
  '0xe9e7cea3dedca5984780bafc599bd69add087d56': { symbol: 'BUSD', decimals: 18, name: 'Binance USD' },
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { symbol: 'USDC', decimals: 18, name: 'USD Coin' },
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { symbol: 'WBNB', decimals: 18, name: 'Wrapped BNB' },
};

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Get active provider with fallback support
 */
async function getProvider() {
  for (const url of config.bscRpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      // Quick check with 3s timeout
      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);
      return provider;
    } catch (err) {
      // try next
    }
  }
  // Fallback to first
  return new ethers.JsonRpcProvider(config.bscRpcUrls[0]);
}

/**
 * Format address into masked form: 0x1234...5678
 */
export function maskAddress(address) {
  if (!address) return 'N/A';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format date nicely in UTC and BD time (UTC+6)
 */
export function formatTxDate(timestampSec) {
  const date = timestampSec ? new Date(timestampSec * 1000) : new Date();
  
  // Format BD Time (UTC+6)
  const options = {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  return new Intl.DateTimeFormat('en-US', options).format(date) + ' (UTC+6)';
}

/**
 * Fetch and decode BSC transaction details
 * @param {string} txHash 
 */
export async function getBscTransactionDetails(txHash) {
  const cleanHash = txHash.trim();
  if (!/^0x([A-Fa-f0-9]{64})$/.test(cleanHash)) {
    throw new Error('Invalid BSC Transaction Hash! It must be 66 characters starting with 0x.');
  }

  const provider = await getProvider();

  // Fetch Transaction and Receipt
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(cleanHash),
    provider.getTransactionReceipt(cleanHash),
  ]);

  if (!tx || !receipt) {
    throw new Error('Transaction not found on Binance Smart Chain yet. Please ensure the transaction has confirmed or check the hash.');
  }

  const isSuccess = receipt.status === 1;
  const status = isSuccess ? 'Confirmed' : 'Failed';

  // Fetch block to get timestamp
  let timestamp = Math.floor(Date.now() / 1000);
  try {
    const block = await provider.getBlock(receipt.blockNumber);
    if (block && block.timestamp) {
      timestamp = block.timestamp;
    }
  } catch (err) {
    // ignore
  }

  let token = 'BNB';
  let amount = '0';
  let sender = tx.from;
  let receiver = tx.to;

  // Check logs for BEP-20 Transfer events
  const transferLog = receipt.logs.find(log => log.topics && log.topics[0] === ERC20_TRANSFER_TOPIC);

  if (transferLog) {
    const contractAddr = transferLog.address.toLowerCase();
    let tokenInfo = KNOWN_TOKENS[contractAddr];

    if (!tokenInfo) {
      try {
        const tokenContract = new ethers.Contract(
          transferLog.address,
          [
            'function symbol() view returns (string)',
            'function decimals() view returns (uint8)'
          ],
          provider
        );
        const [sym, dec] = await Promise.all([
          tokenContract.symbol().catch(() => 'TOKEN'),
          tokenContract.decimals().catch(() => 18)
        ]);
        tokenInfo = { symbol: sym, decimals: Number(dec) };
      } catch (err) {
        tokenInfo = { symbol: 'BEP-20', decimals: 18 };
      }
    }

    token = tokenInfo.symbol;

    try {
      // Decode from, to, amount
      if (transferLog.topics[1]) {
        sender = ethers.getAddress('0x' + transferLog.topics[1].slice(26));
      }
      if (transferLog.topics[2]) {
        receiver = ethers.getAddress('0x' + transferLog.topics[2].slice(26));
      }
      const rawAmount = BigInt(transferLog.data);
      const formatted = ethers.formatUnits(rawAmount, tokenInfo.decimals);
      
      // Clean up trailing zeroes for display
      const num = parseFloat(formatted);
      amount = num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
      });
    } catch (err) {
      amount = '0';
    }
  } else {
    // Native BNB transfer
    token = 'BNB';
    const bnbVal = parseFloat(ethers.formatEther(tx.value || 0n));
    amount = bnbVal.toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6
    });
  }

  return {
    success: true,
    isSuccess,
    status,
    hash: cleanHash,
    from: sender,
    to: receiver,
    token,
    amount,
    network: 'Binance Smart Chain (BEP-20)',
    blockNumber: receipt.blockNumber,
    timestamp,
    formattedDate: formatTxDate(timestamp),
    bscScanUrl: `https://bscscan.com/tx/${cleanHash}`,
  };
}
