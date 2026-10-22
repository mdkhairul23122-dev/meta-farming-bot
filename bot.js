import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, isAdmin } from './config.js';
import { getBscTransactionDetails, formatTxDate } from './bsc.js';
import { 
  formatChannelProofPost, 
  getAdminPreviewButtons 
} from './formatter.js';
import { 
  startAutoPilot, 
  stopAutoPilot, 
  getAutoPilotStatus, 
  saveConfig, 
  runProofCycle 
} from './autopilot.js';
import { formatReceiptDate } from './analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATS_FILE = path.join(__dirname, 'stats.json');

// In-memory admin session storage
const sessions = new Map();

// Helper to load stats
function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Error loading stats:', err);
  }
  return { totalProofs: 0, totalUsdt: 0, totalBnb: 0, lastPostTime: null };
}

export function createBot() {
  const bot = new Telegraf(config.botToken);

  bot.catch((err, ctx) => {
    console.error(`⚠️ Telegram Bot error for ${ctx?.updateType || 'update'}:`, err.message || err);
  });

  // Security Middleware: Identify admin
  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id ? String(ctx.from.id) : null;
    ctx.isAdminUser = isAdmin(fromId);
    return next();
  });

  // Admin main keyboard
  const adminKeyboard = Markup.keyboard([
    ['⚡ Auto-Pilot (Live Tracker)', '📢 Send Real Proofs Now'],
    ['🚀 Post BSC Proof (Tx Hash)', '📝 Custom Manual Proof'],
    ['📊 View Stats', '🔍 Check Channel Permissions'],
    ['❓ Help & Instructions']
  ]).resize();

  // /start command
  bot.start(async (ctx) => {
    const userId = ctx.from.id;
    if (!ctx.isAdminUser) {
      return ctx.replyWithHTML(
        `👋 <b>Welcome to Meta Farming Proof Bot!</b>\n\n` +
        `This bot broadcasts verified BSC payment proofs to <b>${config.channelUsername}</b>.\n` +
        `Your Telegram ID: <code>${userId}</code>\n\n` +
        `👉 <a href="${config.channelLink}">Join Meta Farming Official Channel</a>`
      );
    }

    sessions.delete(userId);
    const apStatus = getAutoPilotStatus();
    const statusEmoji = apStatus.isRunning ? '🟢 Active' : '🔴 Paused';

    await ctx.replyWithHTML(
      `🌾 <b>Meta Farming Payment Proof Control Panel</b> 🌾\n\n` +
      `👋 <b>Hello Admin!</b> (UID: <code>${userId}</code>)\n` +
      `📢 <b>Target Channel:</b> <b>${config.channelUsername}</b>\n` +
      `⚡ <b>Auto-Pilot:</b> ${statusEmoji} (Posting ${apStatus.proofsPerCycle} proofs every ${apStatus.intervalMinutes}m)\n\n` +
      `Choose an option below or send any BSC Tx Hash:`,
      adminKeyboard
    );
  });

  // Auto-Pilot Control Menu
  bot.hears(['⚡ Auto-Pilot (Live Tracker)', '/autopilot'], async (ctx) => {
    if (!ctx.isAdminUser) return;
    const ap = getAutoPilotStatus();
    const statusText = ap.isRunning ? '🟢 ACTIVE (Posting automatically)' : '🔴 PAUSED';

    const buttons = [
      [
        ap.isRunning 
          ? Markup.button.callback('⏸️ Pause Auto-Pilot', 'ap_pause')
          : Markup.button.callback('▶️ Start Auto-Pilot', 'ap_start')
      ],
      [
        Markup.button.callback('🚀 Send 3 Real Proofs Now', 'ap_send_now')
      ],
      [
        Markup.button.callback('⏱️ Interval: ' + ap.intervalMinutes + 'm', 'ap_change_interval'),
        Markup.button.callback('🔢 Proofs/Cycle: ' + ap.proofsPerCycle, 'ap_change_count')
      ]
    ];

    await ctx.replyWithHTML(
      `⚡ <b>Auto-Pilot BSC Payment Analyzer</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📡 <b>Status:</b> ${statusText}\n` +
      `⏱️ <b>Post Interval:</b> Every <b>${ap.intervalMinutes} minute(s)</b>\n` +
      `🔢 <b>Proofs Per Cycle:</b> <b>${ap.proofsPerCycle} real transactions</b>\n` +
      `💰 <b>Amount Filter:</b> <b>${ap.minAmount} - ${ap.maxAmount} USDT</b>\n` +
      `📢 <b>Target Channel:</b> <b>${config.channelUsername}</b>\n\n` +
      `<i>The bot continuously analyzes Binance Smart Chain, detects confirmed live USDT transfers, and automatically posts them to your channel with the official DollarNest/Meta Farming card layout!</i>`,
      Markup.inlineKeyboard(buttons)
    );
  });

  // Action: Start Auto-Pilot
  bot.action('ap_start', async (ctx) => {
    await ctx.answerCbQuery('Starting Auto-Pilot...');
    startAutoPilot(ctx.telegram);
    await ctx.editMessageText('✅ <b>Auto-Pilot Started!</b>\n\nThe bot is now monitoring the BSC blockchain and will post 3 to 4 real proofs every cycle to ' + config.channelUsername, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Open Settings', 'ap_open_menu')],
        [Markup.button.callback('⏸️ Pause Auto-Pilot', 'ap_pause')]
      ]).reply_markup
    });
  });

  // Action: Pause Auto-Pilot
  bot.action('ap_pause', async (ctx) => {
    await ctx.answerCbQuery('Auto-Pilot Paused');
    stopAutoPilot();
    await ctx.editMessageText('⏸️ <b>Auto-Pilot Paused!</b>\n\nAutomatic posting has been stopped. You can resume anytime.', {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('▶️ Resume Auto-Pilot', 'ap_start')],
        [Markup.button.callback('⚙️ Open Settings', 'ap_open_menu')]
      ]).reply_markup
    });
  });

  bot.action('ap_open_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const ap = getAutoPilotStatus();
    const statusText = ap.isRunning ? '🟢 ACTIVE' : '🔴 PAUSED';

    await ctx.editMessageText(
      `⚡ <b>Auto-Pilot Control Menu</b>\n\n` +
      `📡 <b>Status:</b> ${statusText}\n` +
      `⏱️ <b>Interval:</b> Every ${ap.intervalMinutes}m\n` +
      `🔢 <b>Count:</b> ${ap.proofsPerCycle} proofs per cycle`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [
            ap.isRunning 
              ? Markup.button.callback('⏸️ Pause Auto-Pilot', 'ap_pause')
              : Markup.button.callback('▶️ Start Auto-Pilot', 'ap_start')
          ],
          [Markup.button.callback('🚀 Send 3 Real Proofs Now', 'ap_send_now')],
          [
            Markup.button.callback('⏱️ Interval: ' + ap.intervalMinutes + 'm', 'ap_change_interval'),
            Markup.button.callback('🔢 Proofs/Cycle: ' + ap.proofsPerCycle, 'ap_change_count')
          ]
        ]).reply_markup
      }
    );
  });

  // Action: Send Real Proofs Now
  bot.hears(['📢 Send Real Proofs Now', '📢 Send 2 Real Proofs Now', '📢 Send 3 Real Proofs Now', '/post_now'], async (ctx) => {
    if (!ctx.isAdminUser) return;
    const ap = getAutoPilotStatus();
    const progressMsg = await ctx.reply(`🔍 <i>Analyzing BSC blockchain for ${ap.proofsPerCycle} real USDT proofs...</i>`, { parse_mode: 'HTML' });

    const result = await runProofCycle(ctx.telegram, ap.proofsPerCycle);
    if (result.success) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        `🎉 <b>Success!</b>\n\nPosted <b>${result.count} real BSC payment proofs</b> to <b>${config.channelUsername}</b>!\nCheck your channel now. 🚀`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url('👀 Open Channel', config.channelLink)]
          ]).reply_markup
        }
      );
    } else {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        `⚠️ <b>Notice:</b> ${result.reason || result.error || 'Could not post right now.'}\nMake sure the bot is an Administrator in ${config.channelUsername}.`,
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.action('ap_send_now', async (ctx) => {
    await ctx.answerCbQuery('Fetching live BSC transactions...');
    await ctx.editMessageText('🔍 <i>Analyzing BSC blockchain and posting 3-4 real proofs to channel...</i>', { parse_mode: 'HTML' });
    const ap = getAutoPilotStatus();
    const result = await runProofCycle(ctx.telegram, ap.proofsPerCycle);
    if (result.success) {
      await ctx.editMessageText(
        `🎉 <b>Posted ${result.count} Real Proofs to ${config.channelUsername}!</b>\n\nEach message includes real BscScan on-chain confirmation.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url('👀 View Channel', config.channelLink)],
            [Markup.button.callback('⬅️ Back to Menu', 'ap_open_menu')]
          ]).reply_markup
        }
      );
    } else {
      await ctx.editMessageText(`⚠️ <b>Error:</b> ${result.reason || result.error}`, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Menu', 'ap_open_menu')]
        ]).reply_markup
      });
    }
  });

  // Interval selection
  bot.action('ap_change_interval', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `⏱️ <b>Select How Often to Post:</b>\n\nChoose an interval between proof cycles:`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('⚡ Every 1 Min', 'set_interval_1'),
            Markup.button.callback('⏱️ Every 2 Mins', 'set_interval_2')
          ],
          [
            Markup.button.callback('⏱️ Every 3 Mins', 'set_interval_3'),
            Markup.button.callback('⏱️ Every 5 Mins', 'set_interval_5')
          ],
          [Markup.button.callback('⬅️ Back', 'ap_open_menu')]
        ]).reply_markup
      }
    );
  });

  bot.action(/set_interval_(\d+)/, async (ctx) => {
    const mins = parseInt(ctx.match[1], 10);
    saveConfig({ intervalMinutes: mins });
    await ctx.answerCbQuery(`Interval set to ${mins} minute(s)!`);
    // Restart timer if running
    const ap = getAutoPilotStatus();
    if (ap.isRunning) {
      startAutoPilot(ctx.telegram);
    }
    await ctx.editMessageText(`✅ Interval updated to <b>Every ${mins} minute(s)</b>!`, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Menu', 'ap_open_menu')]]).reply_markup
    });
  });

  // Proofs count selection (3 vs 4)
  bot.action('ap_change_count', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🔢 <b>Select Number of Real Proofs per Cycle:</b>`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('2 Proofs / Min', 'set_count_2'),
            Markup.button.callback('3 Proofs / Min', 'set_count_3')
          ],
          [
            Markup.button.callback('4 Proofs / Min', 'set_count_4'),
            Markup.button.callback('5 Proofs / Min', 'set_count_5')
          ],
          [Markup.button.callback('⬅️ Back', 'ap_open_menu')]
        ]).reply_markup
      }
    );
  });

  bot.action(/set_count_(\d+)/, async (ctx) => {
    const count = parseInt(ctx.match[1], 10);
    saveConfig({ proofsPerCycle: count });
    await ctx.answerCbQuery(`Proofs per cycle set to ${count}!`);
    await ctx.editMessageText(`✅ Proofs per cycle updated to <b>${count} real proofs</b>!`, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Menu', 'ap_open_menu')]]).reply_markup
    });
  });

  // /check_channel
  bot.hears(['🔍 Check Channel Permissions', '/check_channel'], async (ctx) => {
    if (!ctx.isAdminUser) return;
    const checkingMsg = await ctx.reply('🔍 Checking connection to ' + config.channelUsername + '...');
    
    try {
      const chat = await ctx.telegram.getChat(config.channelUsername);
      const botMember = await ctx.telegram.getChatMember(config.channelUsername, ctx.botInfo.id);
      const canPost = botMember.status === 'administrator' && (botMember.can_post_messages !== false);

      if (canPost) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          checkingMsg.message_id,
          null,
          `✅ <b>Success! Bot is properly connected!</b>\n\n` +
          `📢 <b>Channel:</b> ${chat.title} (<code>${chat.id}</code>)\n` +
          `🛡️ <b>Status:</b> Administrator\n` +
          `✍️ <b>Can Post Messages:</b> Yes\n\n` +
          `The bot can post proofs automatically! 🚀`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          checkingMsg.message_id,
          null,
          `⚠️ <b>Channel Permission Warning!</b>\n\n` +
          `Bot found channel (<code>${chat.title}</code>), but is not an administrator or cannot post messages.\n\n` +
          `👉 <b>Solution:</b>\n` +
          `1. Open <b>${config.channelUsername}</b>\n` +
          `2. Go to Channel Settings > Administrators\n` +
          `3. Add <b>@${ctx.botInfo.username}</b> as Admin\n` +
          `4. Enable <b>"Post Messages"</b> permission\n` +
          `5. Run /check_channel again!`,
          { parse_mode: 'HTML' }
        );
      }
    } catch (err) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        checkingMsg.message_id,
        null,
        `❌ <b>Error accessing ${config.channelUsername}:</b>\n\n` +
        `<code>${err.message}</code>\n\n` +
        `Please ensure you added <b>@${ctx.botInfo.username}</b> as an Administrator to <b>${config.channelUsername}</b>!`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // /stats
  bot.hears(['📊 View Stats', '/stats'], async (ctx) => {
    if (!ctx.isAdminUser) return;
    const stats = loadStats();
    const ap = getAutoPilotStatus();
    await ctx.replyWithHTML(
      `📊 <b>Meta Farming Payout Statistics</b>\n\n` +
      `✅ <b>Total Proofs Posted:</b> <code>${stats.totalProofs}</code>\n` +
      `💵 <b>Total USDT Volume:</b> <code>${stats.totalUsdt.toFixed(2)} USDT</code>\n` +
      `🕒 <b>Last Post Time:</b> <code>${stats.lastPostTime || 'None yet'}</code>\n` +
      `⚡ <b>Auto-Pilot Status:</b> ${ap.isRunning ? '🟢 Active' : '🔴 Paused'}\n` +
      `📢 <b>Target Channel:</b> ${config.channelUsername}`
    );
  });

  // /help
  bot.hears(['❓ Help & Instructions', '/help'], async (ctx) => {
    if (!ctx.isAdminUser) return;
    await ctx.replyWithHTML(
      `📖 <b>Meta Farming Proof Bot Instructions</b>\n\n` +
      `1. <b>Auto-Pilot:</b> Click <b>⚡ Auto-Pilot</b> to automatically analyze the BSC blockchain and post 3 to 4 real confirmed USDT payouts every few minutes.\n\n` +
      `2. <b>Instant Send:</b> Click <b>📢 Send 3 Real Proofs Now</b> to immediately broadcast 3 real on-chain proofs.\n\n` +
      `3. <b>Direct Post:</b> Simply paste any BSC Transaction Hash (e.g. <code>0x...</code>) in this chat anytime.\n\n` +
      `4. <b>Make sure the bot is an Admin</b> in <b>${config.channelUsername}</b> with "Post Messages" permission!`
    );
  });

  // Manual Tx Hash post flow
  bot.hears(['🚀 Post BSC Proof (Tx Hash)', '/post'], async (ctx) => {
    if (!ctx.isAdminUser) return;
    sessions.set(ctx.from.id, { step: 'AWAIT_TX_HASH' });
    await ctx.replyWithHTML(
      `🔗 <b>Send BSC Transaction Hash</b>\n\n` +
      `Paste any valid BSC Tx Hash (starting with <code>0x</code>):\n\n` +
      `Send /cancel to abort.`,
      Markup.keyboard([['❌ Cancel']]).resize()
    );
  });

  // Custom proof wizard
  bot.hears(['📝 Custom Manual Proof', '/custom'], async (ctx) => {
    if (!ctx.isAdminUser) return;
    sessions.set(ctx.from.id, { step: 'CUSTOM_AMOUNT' });
    await ctx.replyWithHTML(
      `📝 <b>Create Custom Payment Proof</b>\n\n` +
      `Enter the amount in USDT (e.g. <code>50</code>, <code>100</code>, <code>25.5</code>):`,
      Markup.keyboard([['10', '25', '50'], ['100', '250', '500'], ['❌ Cancel']]).resize()
    );
  });

  bot.hears('❌ Cancel', async (ctx) => {
    if (!ctx.isAdminUser) return;
    sessions.delete(ctx.from.id);
    await ctx.reply('❌ Cancelled.', adminKeyboard);
  });

  // Text listener
  bot.on('text', async (ctx) => {
    if (!ctx.isAdminUser) return;
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    let session = sessions.get(userId);

    // Fast Shortcut: If user pastes a BSC Tx Hash
    if (/^0x[a-fA-F0-9]{64}$/.test(text)) {
      session = { step: 'FETCHING_TX', hash: text };
      sessions.set(userId, session);
      return handleDirectTxHash(ctx, text, session);
    }

    if (!session) return;

    if (session.step === 'AWAIT_TX_HASH') {
      return handleDirectTxHash(ctx, text, session);
    }

    if (session.step === 'CUSTOM_AMOUNT') {
      const cleanAmt = text.replace(/usdt/gi, '').trim();
      session.amount = cleanAmt;
      session.step = 'CUSTOM_RECIPIENT';
      return ctx.replyWithHTML(
        `👤 <b>Enter Recipient Username or User ID:</b>\n` +
        `Example: <code>@mr**im</code> or <code>@user123</code> (or click Skip):`,
        Markup.inlineKeyboard([[Markup.button.callback('⏭️ Skip (Auto Mask)', 'skip_custom_user')]])
      );
    }

    if (session.step === 'CUSTOM_RECIPIENT') {
      session.maskedUsername = text.startsWith('@') ? text : `@${text}`;
      return showCustomPreview(ctx, session);
    }
  });

  bot.action('skip_custom_user', async (ctx) => {
    await ctx.answerCbQuery();
    const session = sessions.get(ctx.from.id);
    if (!session) return;
    session.maskedUsername = '@mr**im';
    showCustomPreview(ctx, session);
  });

  async function handleDirectTxHash(ctx, hash, session) {
    const checkingMsg = await ctx.reply('⏳ <i>Analyzing BSC Blockchain...</i>', { parse_mode: 'HTML' });

    try {
      const details = await getBscTransactionDetails(hash);
      await ctx.telegram.deleteMessage(ctx.chat.id, checkingMsg.message_id).catch(() => {});

      const dateStr = formatReceiptDate(details.timestamp);

      const proofData = {
        txHash: details.hash,
        from: details.from,
        to: details.to,
        maskedFrom: details.from.slice(0, 6).toLowerCase() + '...' + details.from.slice(-4).toLowerCase(),
        maskedTo: details.to.slice(0, 6).toLowerCase() + '...' + details.to.slice(-4).toLowerCase(),
        amount: parseFloat(details.amount) ? parseFloat(details.amount).toFixed(4) : details.amount,
        maskedUsername: '@mr**im',
        dateStr
      };

      session.proofData = proofData;
      const previewText = formatChannelProofPost(proofData);

      await ctx.replyWithHTML(
        `👀 <b>CHANNEL POST PREVIEW</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${previewText}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📢 <i>Ready to post to ${config.channelUsername}?</i>`,
        getAdminPreviewButtons()
      );
    } catch (err) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        checkingMsg.message_id,
        null,
        `❌ <b>Error:</b> ${err.message}`,
        { parse_mode: 'HTML' }
      );
    }
  }

  async function showCustomPreview(ctx, session) {
    const dateStr = formatReceiptDate(Math.floor(Date.now() / 1000));
    const numAmt = parseFloat(session.amount || '4.8');

    const proofData = {
      txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      from: '0x8bc000000000000000000000000000000000b689',
      to: '0x22da00000000000000000000000000000000d244',
      maskedFrom: '0x8bc0...b689',
      maskedTo: '0x22da...d244',
      amount: numAmt.toFixed(4),
      maskedUsername: session.maskedUsername || '@username',
      dateStr
    };

    session.proofData = proofData;
    const previewText = formatChannelProofPost(proofData);

    await ctx.replyWithHTML(
      `👀 <b>CUSTOM PROOF PREVIEW</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${previewText}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📢 <i>Post this to ${config.channelUsername}?</i>`,
      getAdminPreviewButtons()
    );
  }

  // Confirm manual post
  bot.action('confirm_post', async (ctx) => {
    const session = sessions.get(ctx.from.id);
    if (!session || !session.proofData) {
      await ctx.answerCbQuery('Session expired!');
      return ctx.reply('⚠️ Please try again.', adminKeyboard);
    }

    const { proofData } = session;
    await ctx.answerCbQuery('Posting to channel...');

    try {
      const messageText = formatChannelProofPost(proofData);
      await ctx.telegram.sendMessage(config.channelUsername, messageText, {
        parse_mode: 'HTML',
        link_preview_options: {
          is_disabled: false
        }
      });

      sessions.delete(ctx.from.id);
      await ctx.editMessageText('✅ <b>Proof successfully posted to channel!</b>', { parse_mode: 'HTML' });
      await ctx.reply('Choose an option:', adminKeyboard);
    } catch (err) {
      await ctx.replyWithHTML(
        `❌ <b>Failed to post to ${config.channelUsername}</b>\n\n<code>${err.message}</code>\n\nMake sure the bot is an Administrator with "Post Messages" permission!`,
        adminKeyboard
      );
    }
  });

  bot.action('cancel_post', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    sessions.delete(ctx.from.id);
    await ctx.editMessageText('❌ Post cancelled.');
    await ctx.reply('Choose an option:', adminKeyboard);
  });

  return bot;
}
