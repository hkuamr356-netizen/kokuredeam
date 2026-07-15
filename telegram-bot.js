/**
 * Telegram Admin Bot – Full Key Manager
 * Exportable to run inside the main server process.
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ============================================================
//  CONFIGURATION (uses environment variables)
// ============================================================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8750220524:AAEvziGps37QhEnsxv01EaoL2BG2cXgrEoU';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '6508116854';
const ADMIN_MASTER_KEY = process.env.ADMIN_MASTER_KEY || 'admin123';

let MAIN_SERVER = '';

function startBot(serverUrl) {
  // If serverUrl provided, use it; otherwise fallback to env or localhost
  MAIN_SERVER = serverUrl || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;

  // Handle both default and named exports
  const Bot = TelegramBot.default || TelegramBot;
  const bot = new Bot(BOT_TOKEN, { polling: true });

  // Helper: send message
  function sendMessage(chatId, text, options = {}) {
    return bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      ...options
    });
  }

  // ---- /start ----
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_CHAT_ID) {
      return sendMessage(chatId, '⛔ Unauthorized access.');
    }
    sendMessage(chatId, `
🤖 <b>Admin Bot – Key Manager</b>

Commands:
/list – Show all users with View/Delete buttons
/newkey [duration] – Generate a new key (e.g., /newkey 1D)
/viewkey [key] – Show details of a specific user
/delkey [key] – Delete a key

Buttons appear in /list for easy management.
    `);
  });

  // ---- /newkey ----
  bot.onText(/\/newkey(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_CHAT_ID) return;
    const duration = match[1] || null;
    try {
      const res = await axios.post(`${MAIN_SERVER}/api/admin/newkey`, {
        masterKey: ADMIN_MASTER_KEY,
        duration
      });
      const key = res.data.key;
      const expires = res.data.expiresAt
        ? new Date(res.data.expiresAt).toLocaleString()
        : 'Unlimited';
      sendMessage(chatId, `
✅ <b>New key generated</b>
Key: <code>${key}</code>
Expires: ${expires}
      `);
    } catch (error) {
      const errMsg = error.response?.data?.error || error.message;
      sendMessage(chatId, `❌ ${errMsg}`);
    }
  });

  // ---- /list ----
  bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_CHAT_ID) return;
    try {
      const res = await axios.get(`${MAIN_SERVER}/api/admin/users?masterKey=${ADMIN_MASTER_KEY}`);
      const users = res.data;
      if (users.length === 0) {
        return sendMessage(chatId, '📭 No users found.');
      }

      const keyboard = {
        inline_keyboard: users.map(u => [
          { text: `👁️ ${u.key}`, callback_data: `view_${u.key}` },
          { text: `🗑️ Delete`, callback_data: `del_${u.key}` }
        ])
      };

      let summary = `👥 <b>${users.length} user(s)</b>\n\n`;
      users.slice(0, 5).forEach(u => {
        const expiry = u.expiresAt ? new Date(u.expiresAt).toLocaleString() : 'Unlimited';
        summary += `🔑 <code>${u.key}</code> | ${u.accountsCount} accounts | Expires: ${expiry}\n`;
      });
      if (users.length > 5) {
        summary += `\n... and ${users.length - 5} more. Use buttons to view all.`;
      }

      sendMessage(chatId, summary, {
        reply_markup: keyboard
      });
    } catch (error) {
      sendMessage(chatId, `❌ ${error.message}`);
    }
  });

  // ---- /viewkey ----
  bot.onText(/\/viewkey (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_CHAT_ID) return;
    const key = match[1].trim();
    try {
      const res = await axios.get(`${MAIN_SERVER}/api/admin/users?masterKey=${ADMIN_MASTER_KEY}`);
      const user = res.data.find(u => u.key === key);
      if (!user) {
        return sendMessage(chatId, `❌ User with key "${key}" not found.`);
      }
      let details = `📋 <b>User details</b>\n`;
      details += `Key: <code>${user.key}</code>\n`;
      details += `IP: ${user.ip}\n`;
      details += `Fingerprint: ${user.fingerprint}\n`;
      details += `Last Login: ${user.lastLogin}\n`;
      details += `Accounts: ${user.accountsCount}\n\n`;
      if (user.accounts && user.accounts.length > 0) {
        details += `📱 Loaded accounts:\n`;
        user.accounts.forEach((acc, idx) => {
          details += `${idx+1}. ${acc.username} | ${acc.password}\n`;
        });
      } else {
        details += `No accounts loaded.`;
      }
      sendMessage(chatId, details);
    } catch (error) {
      sendMessage(chatId, `❌ ${error.message}`);
    }
  });

  // ---- /delkey ----
  bot.onText(/\/delkey (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_CHAT_ID) return;
    const key = match[1].trim();
    try {
      await axios.delete(`${MAIN_SERVER}/api/admin/user?masterKey=${ADMIN_MASTER_KEY}&key=${key}`);
      sendMessage(chatId, `✅ Key "${key}" deleted.`);
    } catch (error) {
      const errMsg = error.response?.data?.error || error.message;
      sendMessage(chatId, `❌ ${errMsg}`);
    }
  });

  // ---- Callback queries ----
  bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const msgId = callbackQuery.message.message_id;

    if (chatId.toString() !== ADMIN_CHAT_ID) {
      bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Unauthorized.' });
      return;
    }

    if (data.startsWith('view_')) {
      const key = data.replace('view_', '');
      try {
        const res = await axios.get(`${MAIN_SERVER}/api/admin/users?masterKey=${ADMIN_MASTER_KEY}`);
        const user = res.data.find(u => u.key === key);
        if (!user) {
          bot.answerCallbackQuery(callbackQuery.id, { text: 'User not found' });
          return;
        }
        let details = `📋 <b>User details</b>\n`;
        details += `Key: <code>${user.key}</code>\n`;
        details += `IP: ${user.ip}\n`;
        details += `Fingerprint: ${user.fingerprint}\n`;
        details += `Last Login: ${user.lastLogin}\n`;
        details += `Accounts: ${user.accountsCount}\n\n`;
        if (user.accounts && user.accounts.length > 0) {
          details += `📱 Loaded accounts:\n`;
          user.accounts.forEach((acc, idx) => {
            details += `${idx+1}. ${acc.username} | ${acc.password}\n`;
          });
        } else {
          details += `No accounts loaded.`;
        }
        bot.sendMessage(chatId, details, { parse_mode: 'HTML' });
        bot.answerCallbackQuery(callbackQuery.id, { text: '✅ User details sent.' });
      } catch (error) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error fetching user.' });
      }
      return;
    }

    if (data.startsWith('del_')) {
      const key = data.replace('del_', '');
      const confirmKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Yes, delete', callback_data: `confirm_del_${key}` },
            { text: '❌ Cancel', callback_data: 'cancel_del' }
          ]
        ]
      };
      bot.editMessageText(
        `⚠️ Are you sure you want to delete key "${key}"?`,
        {
          chat_id: chatId,
          message_id: msgId,
          reply_markup: confirmKeyboard
        }
      );
      bot.answerCallbackQuery(callbackQuery.id, { text: 'Confirm deletion.' });
      return;
    }

    if (data.startsWith('confirm_del_')) {
      const key = data.replace('confirm_del_', '');
      try {
        await axios.delete(`${MAIN_SERVER}/api/admin/user?masterKey=${ADMIN_MASTER_KEY}&key=${key}`);
        bot.editMessageText(
          `✅ Key "${key}" deleted successfully.`,
          {
            chat_id: chatId,
            message_id: msgId
          }
        );
        bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Deleted.' });
      } catch (error) {
        const errMsg = error.response?.data?.error || error.message;
        bot.editMessageText(
          `❌ Failed to delete: ${errMsg}`,
          {
            chat_id: chatId,
            message_id: msgId
          }
        );
        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error.' });
      }
      return;
    }

    if (data === 'cancel_del') {
      bot.editMessageText(
        `❌ Deletion cancelled.`,
        {
          chat_id: chatId,
          message_id: msgId
        }
      );
      bot.answerCallbackQuery(callbackQuery.id, { text: 'Cancelled.' });
      return;
    }

    bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown action.' });
  });

  console.log('🤖 Telegram bot started (polling).');
  console.log(`📡 Bot will call APIs at: ${MAIN_SERVER}`);
}

module.exports = { startBot };
