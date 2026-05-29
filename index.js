const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const FIREBASE_URL = process.env.FIREBASE_URL;
const PHONE_NUMBER = process.env.PHONE_NUMBER;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '';

const orderStates = {};
const userSessions = {};
const BOT_NAME = 'Codex Agent';
const BOT_EMAIL = 'codex1208118@gmail.com';
const IMG_LOGO = 'https://i.ibb.co/rK2fxxkX/image-1780026386311-jpg.jpg';
const DELIVERY_FEE = 50;

const EMOJI = {
  logo: '🌿', sparkle: '✨', yes: '✅', no: '❌', info: 'ℹ️',
  cart: '🛒', food: '🍽️', menu: '📋', pay: '💳', car: '🚗',
  clock: '⏰', star: '⭐', fire: '🔥', wave: '👋', heart: '💚',
  pizza: '🍕', burger: '🍔', coffee: '☕', sweet: '🍰', drink: '🥤',
  phone: '📱', loc: '📍', money: '💰', chef: '👨‍🍳', done: '✅',
  cancel: '🗑️', feedback: '💬', settings: '⚙️', crown: '👑'
};

const CATEGORIES = {
  all: 'All Items', pizza: '🍕 Pizza', burger: '🍔 Burger',
  coffee: '☕ Coffee', sweet: '🍰 Dessert', drink: '🥤 Drinks'
};

function footer() {
  return `\n\n━━━━━━━━━━━━━\n${EMOJI.logo} *${BOT_NAME}* — Fresh & Fast\nReply *help* for commands`;
}

function divider() {
  return `\n${'─'.repeat(30)}`;
}

async function getMenu() {
  try {
    const res = await fetch(`${FIREBASE_URL}/dishes.json`);
    const data = await res.json();
    if (!data) return [];
    return Object.keys(data).map(k => ({
      id: k, name: data[k].name, price: data[k].price,
      imageUrl: data[k].imageUrl, category: (data[k].category || 'all').toLowerCase()
    }));
  } catch (e) {
    console.error('Menu error:', e);
    return [];
  }
}

async function getUserOrders(waNumber) {
  try {
    const res = await fetch(`${FIREBASE_URL}/orders.json?orderBy="userId"&equalTo="whatsapp_${waNumber}"`);
    const data = await res.json();
    if (!data) return [];
    return Object.entries(data).map(([k, v]) => ({ id: k, ...v }));
  } catch { return []; }
}

function orderStatusIcon(status) {
  const map = {
    'Placed': '📝', 'Preparing': '👨‍🍳', 'Out for Delivery': '🚗',
    'Delivered': '✅', 'Cancelled': '🗑️'
  };
  return map[status] || '📝';
}

async function startBot() {
  if (!FIREBASE_URL) { console.log(`${EMOJI.no} FIREBASE_URL missing`); process.exit(1); }
  if (!PHONE_NUMBER) { console.log(`${EMOJI.no} PHONE_NUMBER missing`); process.exit(1); }

  const { state, saveCreds } = await useMultiFileAuthState('session_data');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version, auth: state, printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Codex', 'Agent', '2.0']
  });

  let pairingAttempted = false;

  setTimeout(async () => {
    if (pairingAttempted) return;
    pairingAttempted = true;
    const phone = PHONE_NUMBER.replace(/[^0-9]/g, '');
    try {
      const code = await sock.requestPairingCode(phone);
      const formatted = code.match(/.{1,4}/g)?.join('-') || code;
      console.log('\n' + '='.repeat(50));
      console.log(`  ${EMOJI.logo} CODEX AGENT v2 — PAIRING CODE`);
      console.log('='.repeat(50) + '\n');
      console.log(`       ${formatted}`);
      console.log('\n' + '='.repeat(50));
      console.log(`  ${EMOJI.clock} Expires in 60s`);
      console.log('='.repeat(50) + '\n');
    } catch (e) {
      if (e.message.includes('already') || e.message.includes('registered')) {
        console.log(`${EMOJI.yes} Already registered — starting...`);
      } else { console.log(`${EMOJI.no} Pairing failed: ${e.message}`); pairingAttempted = false; }
    }
  }, 3000);

  // ── LIVE STATUS TRACKER ──
  const userOrderWatchers = {};
  function watchUserOrders(waNumber, sender) {
    const key = `whatsapp_${waNumber}`;
    if (userOrderWatchers[key]) return;
    const ref = `${FIREBASE_URL}/orders.json`;
    let lastCheck = Date.now();
    userOrderWatchers[key] = setInterval(async () => {
      try {
        const res = await fetch(ref);
        const data = await res.json();
        if (!data) return;
        const userOrders = Object.entries(data).filter(([_, v]) => v.userId === key);
        userOrders.forEach(([id, val]) => {
          const t = new Date(val.timestamp || 0).getTime();
          if (t > lastCheck && t < Date.now() - 5000) return;
          if (t > lastCheck - 2000 && t < Date.now()) {
            lastCheck = t;
            const statusIcon = orderStatusIcon(val.status);
            sock.sendMessage(sender, {
              text: `${statusIcon} *Order Update — #${id.substring(1, 6).toUpperCase()}*\n\nStatus: *${val.status}*${divider()}${footer()}`
            }).catch(() => {});
            if (val.status === 'Delivered') {
              setTimeout(() => {
                sock.sendMessage(sender, {
                  text: `${EMOJI.feedback} *How was your ${val.items?.[0]?.name || 'meal'}?*\n\nRate 1-5 (e.g. *5* for excellent)\nOr reply *skip*`
                }).catch(() => {});
                userSessions[sender] = { step: 'RATING', orderId: id };
              }, 60000);
            }
          }
        });
      } catch {}
    }, 15000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      pairingAttempted = true;
      console.log(`${EMOJI.yes} ${BOT_NAME} v2 IS ONLINE!`);
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      Object.values(userOrderWatchers).forEach(clearInterval);
      if (reason !== DisconnectReason.loggedOut) startBot();
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── MAIN MESSAGE HANDLER ──
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
    if (msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const waNumber = sender.split('@')[0];
    const raw = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
    const text = raw.toLowerCase();

    // Start watching this user's orders
    watchUserOrders(waNumber, sender);

    // ── RATING FLOW ──
    if (userSessions[sender]?.step === 'RATING') {
      const val = parseInt(text);
      if (text === 'skip') {
        delete userSessions[sender];
        await sock.sendMessage(sender, { text: `${EMOJI.heart} Thanks for ordering! See you next time.${footer()}` });
        return;
      }
      if (val >= 1 && val <= 5) {
        const stars = '⭐'.repeat(val) + '☆'.repeat(5 - val);
        try {
          await fetch(`${FIREBASE_URL}/ratings.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: 'whatsapp_' + waNumber, orderId: userSessions[sender].orderId,
              rating: val, feedback: '', timestamp: new Date().toISOString()
            })
          });
        } catch {}
        delete userSessions[sender];
        const msg2 = val >= 4 ? `${EMOJI.heart} *${val}/5* ${stars}\n\nWe're thrilled you loved it! 🙏` :
                    val >= 3 ? `${EMOJI.heart} *${val}/5* ${stars}\n\nThanks for your feedback! We'll keep improving.` :
                    `${EMOJI.heart} *${val}/5* ${stars}\n\nSorry we didn't meet expectations. We'll do better!`;
        await sock.sendMessage(sender, { text: msg2 + footer() });
      } else {
        await sock.sendMessage(sender, { text: `${EMOJI.info} Please reply with a number *1-5* or *skip*.` });
      }
      return;
    }

    // ── CART CHECKOUT (ADDRESS COLLECTION) ──
    if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
      const details = raw;
      const cart = orderStates[sender].cart;
      const itemsTotal = cart.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
      const total = (itemsTotal + DELIVERY_FEE).toFixed(2);
      const location = orderStates[sender].location || { lat: 0, lng: 0 };

      const order = {
        userId: 'whatsapp_' + waNumber,
        userEmail: BOT_EMAIL,
        phone: waNumber,
        address: details,
        location,
        items: cart.map(i => ({ id: i.id, name: i.name, price: parseFloat(i.price), img: i.imageUrl || '', quantity: i.quantity })),
        total,
        status: 'Placed',
        method: 'Cash on Delivery (WhatsApp)',
        timestamp: new Date().toISOString()
      };

      try {
        await fetch(`${FIREBASE_URL}/orders.json`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order)
        });
      } catch (e) { console.error('Firebase error:', e); }

      const eta = Math.floor(25 + Math.random() * 20);
      const itemsList = cart.map(i => `${i.quantity}x ${i.name}`).join(', ');
      await sock.sendMessage(sender, {
        text: `${EMOJI.yes} *Order Placed Successfully!*${divider()}` +
          `\n${EMOJI.food} *Items:* ${itemsList}` +
          `\n${EMOJI.money} *Total:* ₹${total} (incl. Delivery ₹${DELIVERY_FEE})` +
          `\n${EMOJI.chef} *Status:* Placed ✓` +
          `\n${EMOJI.clock} *ETA:* ${eta}–${eta + 10} min` +
          `\n${EMOJI.loc} *Delivery:* ${details.substring(0, 50)}...` +
          `${divider()}\nType *my orders* to track | *cancel #ID* to cancel` + footer()
      });
      delete orderStates[sender];
      return;
    }

    // ── CANCEL ORDER ──
    const cancelMatch = text.match(/^cancel\s+#?(\w+)/i);
    if (cancelMatch) {
      const orderIdPrefix = cancelMatch[1].toLowerCase();
      const orders = await getUserOrders(waNumber);
      const target = orders.find(o => o.id.substring(1, 7).toLowerCase() === orderIdPrefix && o.status === 'Placed');
      if (!target) {
        await sock.sendMessage(sender, {
          text: `${EMOJI.no} No active order found with ID *#${orderIdPrefix}*.\n\nType *my orders* to see your orders.` + footer()
        });
        return;
      }
      try {
        await fetch(`${FIREBASE_URL}/orders/${target.id}.json`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Cancelled' })
        });
        await sock.sendMessage(sender, {
          text: `${EMOJI.cancel} *Order #${orderIdPrefix.toUpperCase()} Cancelled*${divider()}\nYour order has been cancelled. Sorry for the inconvenience!\n\nOrder again anytime with *menu*` + footer()
        });
      } catch {
        await sock.sendMessage(sender, { text: `${EMOJI.no} Couldn't cancel. Try again later.` + footer() });
      }
      return;
    }

    // ── START ORDERING ──
    if (text.startsWith('order ')) {
      const query = text.replace('order ', '').trim();
      const menuItems = await getMenu();
      const matches = menuItems.filter(i => i.name.toLowerCase().includes(query));

      if (matches.length === 0) {
        await sock.sendMessage(sender, {
          text: `${EMOJI.no} Sorry, *${query}* isn't on today's menu.` +
            `\n\n${EMOJI.menu} Type *menu* to see all items.` + footer()
        });
        return;
      }

      if (matches.length > 1) {
        let reply = `${EMOJI.menu} *Multiple matches for "${query}"*\n\nReply with the number:\n`;
        matches.forEach((i, idx) => { reply += `\n${idx + 1}. *${i.name}* — ₹${i.price}`; });
        reply += `\n\nExample: *1* for ${matches[0].name}` + footer();
        userSessions[sender] = { step: 'SELECTING_ITEM', matches };
        await sock.sendMessage(sender, { text: reply });
        return;
      }

      const item = matches[0];
      if (!orderStates[sender]) orderStates[sender] = { step: 'SELECTING_QTY', cart: [] };
      orderStates[sender].step = 'SELECTING_QTY';
      orderStates[sender].pendingItem = item;

      const caption = `${EMOJI.cart} *${item.name}* — ₹${item.price}` +
        `\n\nHow many would you like? Reply with a number (1-20).`;

      if (item.imageUrl) {
        await sock.sendMessage(sender, { image: { url: item.imageUrl }, caption });
      } else {
        await sock.sendMessage(sender, { text: caption + footer() });
      }
      return;
    }

    if (text === 'order') {
      await sock.sendMessage(sender, {
        text: `${EMOJI.cart} *How to Order*` +
          `\n\n1. Type *menu* to browse all dishes` +
          `\n2. Type *order [dish]* to start` +
          `\n3. Choose quantity` +
          `\n4. Type *done* to checkout` +
          `\n5. Share your address` +
          `\n\nExample: *order pizza*` + footer()
      });
      return;
    }

    // ── QUANTITY SELECTION ──
    if (orderStates[sender]?.step === 'SELECTING_QTY') {
      const qty = parseInt(text);
      if (isNaN(qty) || qty < 1 || qty > 20) {
        await sock.sendMessage(sender, { text: `${EMOJI.info} Please reply with a number *1-20*.\nExample: *2*` + footer() });
        return;
      }
      const item = orderStates[sender].pendingItem;
      const existing = orderStates[sender].cart.find(i => i.id === item.id);
      if (existing) {
        existing.quantity += qty;
      } else {
        orderStates[sender].cart.push({ ...item, quantity: qty });
      }
      delete orderStates[sender].pendingItem;
      orderStates[sender].step = 'ADD_MORE';

      const cartTotal = orderStates[sender].cart.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
      const cartList = orderStates[sender].cart.map(i => `${i.quantity}x ${i.name} — ₹${(parseFloat(i.price) * i.quantity).toFixed(0)}`).join('\n');

      await sock.sendMessage(sender, {
        text: `${EMOJI.yes} *${qty}x ${item.name}* added!${divider()}` +
          `\n*Your Cart:*\n${cartList}` +
          `\n${EMOJI.money} *Subtotal:* ₹${cartTotal.toFixed(0)}` +
          `${divider()}\n${EMOJI.cart} Type *done* to checkout` +
          `\n${EMOJI.food} Type *order [another]* to add more` +
          `\n${EMOJI.cancel} Type *clear* to empty cart` + footer()
      });
      return;
    }

    // ── DONE / CHECKOUT ──
    if (text === 'done' || text === 'checkout' || text === 'place order') {
      if (!orderStates[sender]?.cart?.length) {
        await sock.sendMessage(sender, { text: `${EMOJI.info} Your cart is empty.\n\nType *menu* to see dishes & order!` + footer() });
        return;
      }
      orderStates[sender].step = 'WAITING_FOR_ADDRESS';
      const cartTotal = orderStates[sender].cart.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
      const itemsList = orderStates[sender].cart.map(i => `${i.quantity}x ${i.name}`).join(', ');

      await sock.sendMessage(sender, {
        text: `${EMOJI.cart} *Checkout*${divider()}` +
          `\n${EMOJI.food} ${itemsList}` +
          `\n${EMOJI.money} *Total:* ₹${(cartTotal + DELIVERY_FEE).toFixed(0)} (incl. Delivery ₹${DELIVERY_FEE})` +
          `${divider()}\n${EMOJI.loc} Please reply with your:\n*Full Name, Phone Number & Delivery Address*` +
          `\n\nOr share your location (tap 📎 > Location)` + footer()
      });
      return;
    }

    // ── CLEAR CART ──
    if (text === 'clear' || text === 'empty') {
      if (orderStates[sender]) { delete orderStates[sender]; }
      await sock.sendMessage(sender, { text: `${EMOJI.cancel} Cart cleared!\n\nType *menu* to start fresh.` + footer() });
      return;
    }

    // ── LOCATION HANDLING ──
    if (msg.message.locationMessage && orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
      const loc = msg.message.locationMessage;
      orderStates[sender].location = { lat: loc.degreesLatitude || 0, lng: loc.degreesLongitude || 0 };
      await sock.sendMessage(sender, {
        text: `${EMOJI.loc} *Location received!*\n\nNow please reply with your complete address:\n*Full Name, Phone Number & Street/Building details*` + footer()
      });
      return;
    }

    // ── SELECT ITEM FROM LIST ──
    if (userSessions[sender]?.step === 'SELECTING_ITEM') {
      const idx = parseInt(text) - 1;
      const matches = userSessions[sender].matches;
      if (isNaN(idx) || idx < 0 || idx >= matches.length) {
        await sock.sendMessage(sender, { text: `${EMOJI.info} Please reply with a number 1-${matches.length}.` + footer() });
        return;
      }
      const item = matches[idx];
      delete userSessions[sender];
      if (!orderStates[sender]) orderStates[sender] = { step: 'SELECTING_QTY', cart: [] };
      orderStates[sender].step = 'SELECTING_QTY';
      orderStates[sender].pendingItem = item;

      const caption = `${EMOJI.cart} *${item.name}* — ₹${item.price}\n\nHow many? Reply with number (1-20).`;
      if (item.imageUrl) {
        await sock.sendMessage(sender, { image: { url: item.imageUrl }, caption });
      } else {
        await sock.sendMessage(sender, { text: caption + footer() });
      }
      return;
    }

    // ── MENU ──
    if (text.includes('menu') || text.includes('price') || text.includes('list') || text.includes('food')) {
      const menuItems = await getMenu();
      if (!menuItems.length) {
        await sock.sendMessage(sender, { text: `${EMOJI.info} Menu is being updated. Check back soon!` + footer() });
        return;
      }

      // Group by category
      const grouped = {};
      menuItems.forEach(i => {
        const cat = i.category || 'all';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(i);
      });

      let reply = `${EMOJI.logo} *${BOT_NAME} — FULL MENU* ${EMOJI.fire}\n`;
      let itemNum = 0;
      Object.entries(grouped).forEach(([cat, items]) => {
        const catName = CATEGORIES[cat] || `📌 ${cat.charAt(0).toUpperCase() + cat.slice(1)}`;
        reply += `${divider()}\n${catName}\n`;
        items.forEach(i => {
          itemNum++;
          reply += `\n${itemNum}. *${i.name}* — ₹${i.price}`;
        });
      });
      reply += `${divider()}\n${EMOJI.cart} To order: *order [dish name]*\nExample: *order pizza*`;
      // Send image of menu if possible
      await sock.sendMessage(sender, { image: { url: IMG_LOGO }, caption: reply });
      return;
    }

    // ── HELP ──
    if (text === 'help' || text === 'commands') {
      await sock.sendMessage(sender, {
        text: `${EMOJI.logo} *${BOT_NAME} — All Commands*${divider()}` +
          `\n${EMOJI.menu} *menu* — Browse full menu` +
          `\n${EMOJI.cart} *order [dish]* — Place order` +
          `\n${EMOJI.cart} *done* — Checkout your cart` +
          `\n${EMOJI.cancel} *clear* — Empty cart` +
          `\n${EMOJI.info} *my orders* — View order history` +
          `\n${EMOJI.cancel} *cancel #ID* — Cancel an order` +
          `\n${EMOJI.star} *rate #ID [1-5]* — Rate an order` +
          `\n${EMOJI.wave} *hi/hello* — Say hello` +
          `\n${EMOJI.phone} *contact* — Get support` +
          `${divider()}\n${EMOJI.sparkle} Powered by ${BOT_NAME}` + footer()
      });
      return;
    }

    // ── GREETINGS ──
    if (['hi', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon', 'assalam', 'salam', 'good day'].some(g => text.includes(g))) {
      const cartCount = orderStates[sender]?.cart?.length || 0;
      const cartNote = cartCount > 0 ? `\n${EMOJI.cart} You have *${cartCount} item(s)* in cart. Type *done* to checkout.` : '';
      await sock.sendMessage(sender, {
        text: `${EMOJI.wave} *Welcome to ${BOT_NAME}!* ${EMOJI.logo}` +
          `\n\nYour AI food delivery assistant.` +
          `\n${EMOJI.food} Craving something? Type *menu*` +
          `\n${EMOJI.cart} Ready to order? Type *order [dish]*` +
          cartNote +
          `\n${EMOJI.info} Need help? Type *help*` + footer()
      });
      return;
    }

    // ── CONTACT ──
    if (text.includes('contact') || text.includes('call') || text.includes('email') || text.includes('support') || text.includes('help')) {
      await sock.sendMessage(sender, {
        text: `${EMOJI.phone} *Contact ${BOT_NAME}*` +
          `\n\n📧 Email: ${BOT_EMAIL}` +
          `\n${EMOJI.logo} Website: codexagent.app` +
          `\n${EMOJI.clock} Support hours: 24/7` +
          `${divider()}\n${EMOJI.cart} To order: *menu* → *order [dish]*` + footer()
      });
      return;
    }

    // ── MY ORDERS ──
    if (text === 'my orders' || text === 'my order' || text === 'orders' || text === 'track') {
      const orders = await getUserOrders(waNumber);
      if (!orders.length) {
        await sock.sendMessage(sender, {
          text: `${EMOJI.info} You haven't ordered yet.` +
            `\n\n${EMOJI.cart} Browse *menu* and place your first order!` + footer()
        });
        return;
      }
      const recent = orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);
      let reply = `${EMOJI.logo} *Your Orders*\n\n`;
      recent.forEach(o => {
        const id = o.id.substring(1, 6).toUpperCase();
        const items = o.items ? o.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : 'N/A';
        const icon = orderStatusIcon(o.status);
        reply += `${icon} *#${id}* — ${o.status}\n  └ ${items} — ₹${o.total}\n`;
        if (o.status === 'Placed') reply += `  └ Cancel: *cancel #${id.toLowerCase()}*\n`;
        reply += '\n';
      });
      reply += `━━━━━━━━━━━━━\n${EMOJI.cart} *order [dish]* to order more`;
      await sock.sendMessage(sender, { text: reply });
      return;
    }

    // ── ADMIN BROADCAST ──
    if (ADMIN_NUMBER && waNumber === ADMIN_NUMBER.replace(/[^0-9]/g, '') && text.startsWith('broadcast ')) {
      const broadcastMsg = raw.replace('broadcast ', '');
      try {
        const res = await fetch(`${FIREBASE_URL}/orders.json`);
        const data = await res.json();
        const uniqueUsers = new Set();
        if (data) Object.values(data).forEach(o => { if (o.userId) uniqueUsers.add(o.userId); });
        let sent = 0;
        for (const uid of uniqueUsers) {
          const jid = uid.replace('whatsapp_', '') + '@s.whatsapp.net';
          try {
            await sock.sendMessage(jid, { text: `${EMOJI.logo} *${BOT_NAME} Announcement*${divider()}\n\n${broadcastMsg}${footer()}` });
            sent++;
          } catch {}
        }
        await sock.sendMessage(sender, { text: `${EMOJI.yes} Broadcast sent to ${sent} users.` });
      } catch (e) { await sock.sendMessage(sender, { text: `${EMOJI.no} Broadcast failed: ${e.message}` }); }
      return;
    }

    // ── RATING FROM TEXT ──
    const rateMatch = text.match(/^rate\s+#?(\w+)\s+([1-5])/i);
    if (rateMatch) {
      const orderId = rateMatch[1];
      const rating = parseInt(rateMatch[2]);
      try {
        await fetch(`${FIREBASE_URL}/ratings.json`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'whatsapp_' + waNumber, orderId, rating, timestamp: new Date().toISOString() })
        });
        await sock.sendMessage(sender, { text: `${EMOJI.heart} Thanks for the ${rating}/5 rating! 🙏` + footer() });
      } catch { await sock.sendMessage(sender, { text: `${EMOJI.no} Couldn't save rating.` + footer() }); }
      return;
    }

    // ── FALLBACK ──
    const cartNote = orderStates[sender]?.cart?.length > 0
      ? `\n\n${EMOJI.cart} Cart: ${orderStates[sender].cart.length} item(s) — Type *done* to checkout or *clear* to empty`
      : '';
    await sock.sendMessage(sender, {
      text: `${EMOJI.info} I didn't understand that.${cartNote}${divider()}` +
        `\n${EMOJI.menu} *menu* — Browse dishes` +
        `\n${EMOJI.cart} *order [dish]* — Order food` +
        `\n${EMOJI.info} *my orders* — View orders` +
        `\n${EMOJI.info} *help* — All commands` + footer()
    });
  });
}

startBot().catch(e => console.log(`${EMOJI.no} ${e.message}`));