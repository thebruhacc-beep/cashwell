// app.js — NeonFinance full frontend (vanilla JS, no build step)
'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
const STATE = {
  user:         null,
  token:        localStorage.getItem('nf_token') || null,
  page:         'dashboard',
  transactions: [],
  wallet:       [],
  categories:   [],
  group:        null,
  deposits:     [],
  messages:     [],
  socket:       null,
  charts:       {},   // chart.js instances keyed by canvas id
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SLICE_COLORS = ['#00ff88','#00d4ff','#bf5fff','#ffe600','#ff8c00','#ff3366','#00ffcc','#c084fc'];
const PERIODS      = ['day','week','month','year','total'];
const PLABEL       = {day:'DAY',week:'WEEK',month:'MONTH',year:'YEAR',total:'ALL TIME'};
const NAV_ITEMS    = [
  {id:'dashboard',  icon:'◈', label:'Dashboard'},
  {id:'charts',     icon:'◉', label:'Charts'},
  {id:'wallet',     icon:'◎', label:'Wallet'},
  {id:'groups',     icon:'◈', label:'Group Fund'},
  {id:'chat',       icon:'◇', label:'Chat'},
  {id:'leaderboard',icon:'◆', label:'Rankings'},
  {id:'insights',   icon:'◐', label:'AI Insights'},
  {id:'settings',   icon:'⚙', label:'Settings'},
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const q = sel => document.querySelector(sel);

function fmt(n) {
  const a = Math.abs(n), s = n >= 0 ? '+' : '-';
  if (a >= 1e6) return `${s}$${(a/1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a/1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(2)}`;
}
function fmtPlain(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(a/1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(a/1e3).toFixed(1)}K`;
  return `$${a.toFixed(2)}`;
}
const todayStr  = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const cutoffMap = {
  day:   () => todayStr(),
  week:  () => { const d=new Date(); d.setDate(d.getDate()-7);         return localDateStr(d); },
  month: () => { const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return localDateStr(d); },
  year:  () => { const d=new Date(); d.setDate(1); d.setFullYear(d.getFullYear()-1); return localDateStr(d); },
  total: () => '0000-00-00',
};

function uid() { return Math.random().toString(36).slice(2,10); }

// Robust date parser — always returns YYYY-MM-DD or null
function parseDate(raw) {
  if (!raw) return null;
  // Already a JS Date object (SheetJS cellDates:true)
  if (raw instanceof Date) {
    if (isNaN(raw)) return null;
    // Use UTC to avoid timezone shifts
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth()+1).padStart(2,'0');
    const d = String(raw.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY — European format, auto-detect by checking which part > 12
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split('/');
    let day, mon;
    const a = parseInt(parts[0]), b = parseInt(parts[1]);
    const y = parts[2];
    // If first number > 12, it must be the day (DD/MM)
    // If second number > 12, it must be the day (MM/DD) — swap
    // Otherwise assume DD/MM (European default)
    if (a > 12) { day = parts[0]; mon = parts[1]; }
    else if (b > 12) { day = parts[1]; mon = parts[0]; }
    else { day = parts[0]; mon = parts[1]; } // assume DD/MM
    day = day.padStart(2,'0'); mon = mon.padStart(2,'0');
    if (parseInt(mon) < 1 || parseInt(mon) > 12) return null;
    if (parseInt(day) < 1 || parseInt(day) > 31) return null;
    return `${y}-${mon}-${day}`;
  }
  // DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [d,m,y] = s.split('-');
    const day = d.padStart(2,'0'), mon = m.padStart(2,'0');
    if (parseInt(mon) < 1 || parseInt(mon) > 12) return null;
    return `${y}-${mon}-${day}`;
  }
  // Excel serial number (number as string e.g. "45678")
  if (/^\d{4,5}$/.test(s)) {
    const serial = parseInt(s);
    const d = new Date(Date.UTC(1899,11,30) + serial*86400000);
    if (isNaN(d)) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const dd = String(d.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  // Try native parse as last resort
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().split('T')[0];
}

function filterByPeriod(txns, period) {
  // First remove any transactions with invalid/missing dates
  const valid = txns.filter(t => t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date));
  if (period === 'day')   return valid.filter(t => t.date === todayStr());
  if (period === 'total') return valid;
  return valid.filter(t => t.date >= cutoffMap[period]());
}

function bucketsByPeriod(txns, period) {
  const m = {};
  // Only bucket transactions within the current period
  const filtered = filterByPeriod(txns, period);
  filtered.forEach(t => {
    let k;
    const d = new Date(t.date + 'T00:00:00');
    if      (period === 'day')   k = t.date;
    else if (period === 'week')  { const s=new Date(d); s.setDate(d.getDate()-d.getDay()); k=s.toISOString().split('T')[0]; }
    else if (period === 'month') k = t.date.slice(0,7);
    else if (period === 'year')  k = t.date.slice(0,4);
    else k = t.date.slice(0,7);
    m[k] = (m[k]||0) + t.amount;
  });
  return m;
}

function el(tag, attrs={}, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => {
    if (k === 'className') e.className = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (c == null) return;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}

function html(str) {
  const d = document.createElement('div');
  d.innerHTML = str;
  return d.firstElementChild;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(title, body='') {
  $('toast-title').textContent = title;
  $('toast-body').textContent  = body;
  const t = $('toast');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ─── COPY TO CLIPBOARD ────────────────────────────────────────────────────────
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ COPIED';
    setTimeout(() => btn.textContent = orig, 2000);
  });
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(STATE.token ? { Authorization: `Bearer ${STATE.token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── SOCKET ───────────────────────────────────────────────────────────────────
function initSocket() {
  if (STATE.socket) STATE.socket.disconnect();
  const socket = io({ auth: { token: STATE.token } });

  socket.on('connect', () => console.log('🔌 Socket connected'));
  socket.on('disconnect', () => console.log('🔌 Socket disconnected'));

  socket.on('message:new', msg => {
    if (!STATE.messages.find(m => m.id === msg.id)) {
      STATE.messages.push(msg);
      if (STATE.page === 'chat') renderPage();
      toast('New Message', `${msg.username}: ${msg.type==='poll'?'📊 Poll':msg.content}`);
    }
  });

  socket.on('deposit:update', () => {
    loadAll().then(() => { if (STATE.page === 'groups') renderPage(); });
    toast('Deposit Updated', 'Fund status changed');
  });

  socket.on('group:refresh', () => {
    loadAll().then(() => renderPage());
    toast('Group Updated', 'Group data refreshed');
  });

  STATE.socket = socket;
}

// ─── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadAll() {
  const [txns, wal, cats, grp, deps, msgs] = await Promise.all([
    api('GET', '/transactions'),
    api('GET', '/wallet'),
    api('GET', '/categories'),
    api('GET', '/groups/mine'),
    api('GET', '/deposits'),
    api('GET', '/messages'),
  ]);
  STATE.transactions = txns;
  STATE.wallet       = wal;
  STATE.categories   = cats;
  STATE.group        = grp;
  STATE.deposits     = deps;
  STATE.messages     = msgs;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function renderAuth() {
  let mode = 'login';

  const wrap = el('div', {className:'auth-wrap'});
  const card = el('div', {className:'card auth-card slide'});
  wrap.append(card);

  function buildCard() {
    card.innerHTML = '';

    // Logo
    card.append(html(`
      <div style="text-align:center;margin-bottom:34px">
        <div style="font-family:Orbitron,sans-serif;font-size:24px;font-weight:900;letter-spacing:2px">
          <span class="ng">NEON</span><span>FINANCE</span>
        </div>
        <div class="mut f11 mt4" style="letter-spacing:2px">GROUP WEALTH TRACKER</div>
      </div>
    `));

    // Mode toggle
    const toggleRow = el('div', {className:'form-row mb16'});
    ['login','register'].forEach(m => {
      const b = el('button', {className:`btn ${mode===m?'btn-gh':'btn-o'}`, style:{flex:'1'}}, m==='login'?'SIGN IN':'REGISTER');
      b.onclick = () => { mode = m; buildCard(); };
      toggleRow.append(b);
    });
    card.append(toggleRow);

    const form = el('div', {className:'form-col'});

    let displayNameInput;
    if (mode === 'register') {
      displayNameInput = el('input', {className:'inp', placeholder:'Display Name', type:'text'});
      form.append(displayNameInput);
    }

    const usernameInput = el('input', {className:'inp', placeholder:'Username', type:'text', autocomplete:'username'});
    const passwordInput = el('input', {className:'inp', placeholder:'Password', type:'password', autocomplete: mode==='login'?'current-password':'new-password'});
    const errDiv        = el('div', {className:'err'});
    const submitBtn     = el('button', {className:'btn btn-g btn-full', style:{marginTop:'8px'}}, mode==='login'?'ENTER THE GRID':'CREATE ACCOUNT');

    async function doAuth() {
      errDiv.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '...';
      try {
        let result;
        if (mode === 'login') {
          result = await api('POST', '/auth/login', { username: usernameInput.value.trim(), password: passwordInput.value });
        } else {
          result = await api('POST', '/auth/register', {
            username:    usernameInput.value.trim(),
            password:    passwordInput.value,
            displayName: displayNameInput.value.trim(),
          });
        }
        STATE.token = result.token;
        STATE.user  = result.user;
        localStorage.setItem('nf_token', result.token);
        await loadAll();
        initSocket();
        renderApp();
      } catch(e) {
        errDiv.textContent = e.message;
        submitBtn.disabled = false;
        submitBtn.textContent = mode==='login'?'ENTER THE GRID':'CREATE ACCOUNT';
      }
    }

    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
    submitBtn.onclick = doAuth;

    form.append(usernameInput, passwordInput, errDiv, submitBtn);
    card.append(form);

    card.append(html(`<div class="mut f11 text-center mt16">Accounts are stored on the server</div>`));
  }

  buildCard();
  return wrap;
}

// ─── TICKER BAR ───────────────────────────────────────────────────────────────
let cryptoPrices = { BTC: 0, SOL: 0, USDC: 1 };
async function fetchCryptoPrices() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana,usd-coin&vs_currencies=usd');
    const data = await res.json();
    cryptoPrices.BTC  = data.bitcoin?.usd  || cryptoPrices.BTC;
    cryptoPrices.SOL  = data.solana?.usd   || cryptoPrices.SOL;
    cryptoPrices.USDC = data['usd-coin']?.usd || 1;
    const t = $('ticker-inner');
    if (t) t.innerHTML = tickerInner();
    // Also update wallet page if open
    const cryptoRows = document.querySelectorAll('.crypto-price-val');
    cryptoRows.forEach(el => {
      const sym = el.dataset.sym;
      if (sym && cryptoPrices[sym] !== undefined) el.textContent = '$' + Number(cryptoPrices[sym]).toLocaleString();
    });
  } catch(e) { console.warn('Crypto fetch failed:', e); }
}
function startTicker() {
  fetchCryptoPrices();
  setInterval(fetchCryptoPrices, 60000);
}

function tickerInner() {
  return `
    <span style="font-family:Orbitron,sans-serif;font-size:11px;color:#00d4ff;letter-spacing:2px">LIVE</span>
    <span class="pulse" style="color:#00d4ff;font-size:10px">●</span>
    ${[{s:'BTC',p:cryptoPrices.BTC},{s:'SOL',p:cryptoPrices.SOL},{s:'USDC',p:cryptoPrices.USDC}].map(({s,p})=>`
      <span style="font-size:12px;display:inline-flex;align-items:center;gap:6px">
        <span class="mut">${s}</span>
        <span style="color:#00ff88;font-weight:700">$${Number(p).toLocaleString()}</span>
      </span>
    `).join('')}
    <span style="margin-left:auto;font-size:11px;color:#64748b">${new Date().toLocaleTimeString()}</span>
  `;
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function buildSidebar() {
  const pendingCount = STATE.deposits.filter(d => d.status==='pending' && STATE.group?.admin_id===STATE.user?.id).length;
  const walletTotal  = STATE.wallet.reduce((s,w) => s+w.balance, 0);
  const txTotal      = STATE.transactions.reduce((s,t) => s+t.amount, 0);
  const netWorth     = walletTotal + txTotal;

  const sb = el('div', {className:'sidebar'});

  // Logo
  sb.append(html(`
    <div class="logo">
      <div class="logo-text"><span class="ng">NEON</span>FIN</div>
      <div class="logo-sub">@${STATE.user.username}</div>
    </div>
  `));

  // Net worth box
  sb.append(html(`
    <div class="net-worth-box mb12">
      <div class="net-worth-label">NET WORTH</div>
      <div class="net-worth-value ${netWorth>=0?'ng':'nr'}">${fmt(netWorth)}</div>
    </div>
  `));

  // Nav items
  NAV_ITEMS.forEach(item => {
    const badge = item.id==='groups' && pendingCount>0 ? pendingCount : 0;
    const navEl = el('div', {
      className: `nav-item ${STATE.page===item.id?'active':''}`,
      onclick: () => { STATE.page = item.id; renderApp(); }
    });
    navEl.innerHTML = `<span style="font-size:14px">${item.icon}</span><span>${item.label}</span>${badge?`<span class="nav-badge">${badge}</span>`:''}`;
    sb.append(navEl);
  });

  // Footer
  const footer = el('div', {className:'sidebar-footer'});
  const signOut = el('div', {className:'nav-item', style:{color:'#ff3366'}, onclick: logout});
  signOut.innerHTML = '<span>⊗</span><span>Sign Out</span>';
  footer.append(signOut);
  sb.append(footer);

  return sb;
}

function logout() {
  localStorage.removeItem('nf_token');
  STATE.token = null; STATE.user = null; STATE.socket?.disconnect();
  Object.assign(STATE, {transactions:[],wallet:[],categories:[],group:null,deposits:[],messages:[]});
  renderAuth();
  document.getElementById('app').innerHTML = '';
  document.getElementById('app').append(renderAuth());
}

// ─── MAIN RENDER ──────────────────────────────────────────────────────────────
function renderApp() {
  const app = $('app');
  app.innerHTML = '';

  // Ticker
  const ticker = el('div', {className:'ticker', id:'ticker-inner'});
  ticker.innerHTML = tickerInner();
  app.append(ticker);

  const layout = el('div', {className:'main-layout'});

  // Sidebar
  layout.append(buildSidebar());

  // Mobile header
  const mobHeader = el('div', {className:'mob-header', id:'mob-header'});
  mobHeader.innerHTML = `
    <div style="font-family:Orbitron,sans-serif;font-size:16px;font-weight:900"><span class="ng">NEON</span>FIN</div>
    <div class="flex-gap8">
      <button class="btn btn-g btn-sm" id="mob-add">+ ADD</button>
      <button class="btn btn-gh btn-sm" id="mob-menu-btn">☰</button>
    </div>
  `;

  const mobMenu = el('div', {className:'mob-menu', id:'mob-menu'});
  NAV_ITEMS.forEach(item => {
    const ni = el('div', {className:`nav-item ${STATE.page===item.id?'active':''}`, onclick:()=>{ STATE.page=item.id; $('mob-menu').style.display='none'; renderPage(); }});
    ni.textContent = item.label;
    mobMenu.append(ni);
  });
  const signOutMob = el('div',{className:'nav-item',style:{color:'#ff3366'},onclick:logout});
  signOutMob.textContent='Sign Out'; mobMenu.append(signOutMob);

  const contentWrap = el('div', {className:'content'});
  contentWrap.append(mobHeader, mobMenu);

  const pageDiv = el('div', {className:'page', id:'page-content'});
  contentWrap.append(pageDiv);
  layout.append(contentWrap);
  app.append(layout);

  // Events
  setTimeout(() => {
    const addBtn = $('mob-add');
    if (addBtn) addBtn.onclick = () => showAddTxModal();
    const menuBtn = $('mob-menu-btn');
    if (menuBtn) menuBtn.onclick = () => {
      const m = $('mob-menu');
      m.style.display = m.style.display==='flex'?'none':'flex';
    };
  }, 0);

  renderPage();
  startTicker();
}

function renderPage() {
  const pageDiv = $('page-content');
  if (!pageDiv) return;
  // Destroy ALL chart instances before wiping DOM to prevent canvas reuse glitch
  Object.keys(STATE.charts).forEach(k => {
    try { STATE.charts[k].destroy(); } catch {}
    delete STATE.charts[k];
  });
  txPage = 0;
  pageDiv.innerHTML = '';

  // Page header
  const header = el('div', {className:'page-header'});
  const title  = NAV_ITEMS.find(n => n.id===STATE.page)?.label || 'Dashboard';
  const left   = html(`<div><div class="page-title">${title}</div><div class="page-date">${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div></div>`);
  const addBtn    = el('button', {className:'btn btn-g glow-g', onclick: showAddTxModal}, '+ ADD ENTRY');
  const importBtn = el('button', {className:'btn btn-gh', style:{marginRight:'8px'}, onclick: showImportModal}, '⬆ IMPORT');
  const btnGroup  = el('div', {className:'flex-gap8'});
  btnGroup.append(importBtn, addBtn);
  header.append(left, btnGroup);
  pageDiv.append(header);

  // Render correct page
  const pages = {
    dashboard:   renderDashboard,
    charts:      renderCharts,
    wallet:      renderWalletPage,
    groups:      renderGroupsPage,
    chat:        renderChatPage,
    leaderboard: renderLeaderboard,
    insights:    renderInsights,
    settings:    renderSettings,
  };
  const fn = pages[STATE.page];
  if (fn) fn(pageDiv);
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
let currentPeriod = 'day';

function renderDashboard(container) {
  const col = el('div', {className:'flex-col', style:{gap:'20px'}});

  // 1. Period tabs + grote stat kaart + records
  try { col.append(buildPeriodStats()); } catch(e) { console.error('PeriodStats error',e); }

  // 2. Chart (vol breedte, reageert op currentPeriod)
  try { col.append(buildIncomeChartCard()); } catch(e) { console.error('IncomeChart error',e); }

  // 3. Wallet kaart (vol breedte)
  try { col.append(buildWalletCard()); } catch(e) { console.error('WalletCard error',e); }

  // 4. Heatmap + entries lijst
  try { col.append(buildHeatmap()); } catch(e) { console.error('Heatmap error',e); }
  try { col.append(buildTxList()); } catch(e) { console.error('TxList error',e); }

  container.append(col);
}

// ─── PERIOD STATS ─────────────────────────────────────────────────────────────
function buildPeriodStats() {
  const wrap = el('div', {className:'flex-col', style:{gap:'16px'}});

  // Tab buttons
  const tabs = el('div', {className:'ptabs'});
  PERIODS.forEach(p => {
    const b = el('button', {
      className: `ptab ${currentPeriod===p?'active':''}`,
      onclick: () => { currentPeriod=p; renderPage(); }
    }, PLABEL[p]);
    tabs.append(b);
  });
  wrap.append(tabs);

  const inner = buildPeriodStatsInner();
  inner.id = 'period-stats-wrap';
  wrap.append(inner);
  return wrap;
}

function buildPeriodStatsInner() {
  const txns    = filterByPeriod(STATE.transactions, currentPeriod);
  const total   = txns.reduce((s,t)=>s+t.amount,0);
  const profits = txns.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
  const losses  = txns.filter(t=>t.amount<0).reduce((s,t)=>s+t.amount,0);

  // Records — best = hoogste dag/week/maand, worst = laagste
  const recs = {};
  PERIODS.forEach(p => {
    const b = bucketsByPeriod(STATE.transactions, p);
    const v = Object.values(b).filter(x => x !== 0);
    recs[p] = {
      best:  v.length ? Math.max(...v) : null,
      worst: v.length ? Math.min(...v) : null
    };
  });
  const cr = recs[currentPeriod];

  const wrap = el('div', {className:'flex-col', style:{gap:'16px'}});

  // Main stat card
  const mainCard = el('div', {className:`card ${total>=0?'glow-g':''}`, style:{padding:'28px 24px', borderColor: total>=0?'rgba(0,255,136,.25)':'rgba(255,51,102,.25)'}});
  mainCard.innerHTML = `
    <div class="section-title">${PLABEL[currentPeriod]} PERFORMANCE</div>
    <div style="font-family:Orbitron,sans-serif;font-size:44px;font-weight:900" class="${total>=0?'ng':'nr'}">${fmt(total)}</div>
    <div class="flex-gap8 mt16" style="flex-wrap:wrap;gap:24px">
      <div><div class="f11 mut" style="letter-spacing:1px">PROFIT</div><div style="font-family:Orbitron,sans-serif;font-size:16px;color:#00ff88;margin-top:2px">+$${profits.toFixed(2)}</div></div>
      <div><div class="f11 mut" style="letter-spacing:1px">LOSS</div><div style="font-family:Orbitron,sans-serif;font-size:16px;color:#ff3366;margin-top:2px">${fmt(losses)}</div></div>
      <div><div class="f11 mut" style="letter-spacing:1px">ENTRIES</div><div style="font-family:Orbitron,sans-serif;font-size:16px;color:#00d4ff;margin-top:2px">${txns.length}</div></div>
    </div>
  `;
  wrap.append(mainCard);

  // Records
  const recsRow = el('div', {className:'g2'});
  const bestCard = el('div', {className:'record-bar best'});
  bestCard.innerHTML = `<div><div class="record-label">BEST ${PLABEL[currentPeriod]}</div><div class="record-value ny">${cr.best!==null?fmt(cr.best):'—'}</div></div><span style="font-size:24px">🏆</span>`;
  const worstCard = el('div', {className:'record-bar worst'});
  worstCard.innerHTML = `<div><div class="record-label">WORST ${PLABEL[currentPeriod]}</div><div class="record-value nr">${cr.worst!==null?fmt(cr.worst):'—'}</div></div><span style="font-size:24px">📉</span>`;
  recsRow.append(bestCard, worstCard);
  wrap.append(recsRow);

  return wrap;
}

// ─── INCOME CHART ─────────────────────────────────────────────────────────────
function buildIncomeChartCard() {
  const p = currentPeriod;
  const periodLabels = {day:'TODAY',week:'7D',month:'30D',year:'12M',total:'ALL'};
  const card = el('div', {className:'card', style:{padding:'20px 20px 14px'}});
  card.innerHTML = `<div class="section-title mb12">INCOME OVER TIME (${periodLabels[p]||'30D'})</div>`;
  const chartWrap = el('div', {style:{position:'relative',height:'200px',width:'100%'}});
  const canvas = el('canvas', {id:'income-chart'});
  chartWrap.append(canvas);
  card.append(chartWrap);

  setTimeout(() => {
    try {
      const cvs = $('income-chart');
      if (!cvs) return;

      const now = new Date();
      const txns = STATE.transactions;
      let labels = [], dailyData = [], cumData = [];

      if (p === 'day') {
        // 24 hours, put all today's transactions at their hour (no hour stored, use noon)
        const todayKey = now.toISOString().split('T')[0];
        const todayTotal = txns.filter(t=>t.date===todayKey).reduce((s,t)=>s+t.amount,0);
        labels = [...Array(24)].map((_,i)=>String(i).padStart(2,'0')+':00');
        dailyData = Array(24).fill(0);
        dailyData[12] = +todayTotal.toFixed(2);
        let c=0; cumData = dailyData.map(v=>{c+=v;return +c.toFixed(2);});

      } else if (p === 'week') {
        const days = [...Array(7)].map((_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); return localDateStr(d); });
        const map = {}; days.forEach(d=>{map[d]=0;});
        txns.forEach(t=>{ if(map[t.date]!==undefined) map[t.date]+=t.amount; });
        labels = days.map(d=>new Date(d+'T12:00:00').toLocaleDateString('en',{weekday:'short'}));
        dailyData = days.map(d=>+(map[d]||0).toFixed(2));
        let c=0; cumData = dailyData.map(v=>{c+=v;return +c.toFixed(2);});

      } else if (p === 'month') {
        const days = [...Array(30)].map((_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(29-i)); return localDateStr(d); });
        const map = {}; days.forEach(d=>{map[d]=0;});
        txns.forEach(t=>{ if(map[t.date]!==undefined) map[t.date]+=t.amount; });
        labels = days.map(d=>d.slice(5));
        dailyData = days.map(d=>+(map[d]||0).toFixed(2));
        let c=0; cumData = dailyData.map(v=>{c+=v;return +c.toFixed(2);});

      } else if (p === 'year') {
        const months = [...Array(12)].map((_,i)=>`${now.getFullYear()}-${String(i+1).padStart(2,'0')}`);
        const map = {}; months.forEach(m=>{map[m]=0;});
        txns.forEach(t=>{ const mk=t.date.slice(0,7); if(map[mk]!==undefined) map[mk]+=t.amount; });
        labels = months.map(m=>new Date(m+'-15').toLocaleDateString('en',{month:'short'}));
        dailyData = months.map(m=>+(map[m]||0).toFixed(2));
        let c=0; cumData = dailyData.map(v=>{c+=v;return +c.toFixed(2);});

      } else {
        // total: use all unique year-months sorted
        const monthSet = new Set(txns.map(t=>t.date.slice(0,7)));
        const months = [...monthSet].sort();
        if (!months.length) { months.push(now.toISOString().slice(0,7)); }
        const map = {}; months.forEach(m=>{map[m]=0;});
        txns.forEach(t=>{ const mk=t.date.slice(0,7); if(map[mk]!==undefined) map[mk]+=t.amount; });
        labels = months.map(m=>{ try{ return new Date(m+'-15').toLocaleDateString('en',{month:'short',year:'2-digit'}); } catch{ return m; } });
        dailyData = months.map(m=>+(map[m]||0).toFixed(2));
        let c=0; cumData = dailyData.map(v=>{c+=v;return +c.toFixed(2);});
      }

      const ctx = cvs.getContext('2d');
      STATE.charts['income-chart'] = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label:'Cumulative', data:cumData,   borderColor:'#00ff88', borderWidth:2,   pointRadius:0, tension:.4, fill:false },
            { label:'Daily',      data:dailyData, borderColor:'#00d4ff', borderWidth:1.5, borderDash:[4,2], pointRadius:0, tension:.4, fill:false },
          ]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          animation:{ duration:200 },
          plugins:{ legend:{ labels:{ color:'#64748b', font:{family:'Space Mono'}, boxWidth:12 } } },
          scales:{
            x:{ ticks:{ color:'#64748b', maxRotation:0, maxTicksLimit:12 }, grid:{ color:'rgba(255,255,255,.04)' } },
            y:{ ticks:{ color:'#64748b', callback:v=>`$${v}` }, grid:{ color:'rgba(255,255,255,.04)' } }
          }
        }
      });
    } catch(e) {
      console.error('Chart render error:', e);
      const wrap = $('income-chart')?.parentElement;
      if (wrap) wrap.innerHTML = '<div class="mut f12" style="padding:20px;text-align:center">Chart unavailable</div>';
    }
  }, 50);

  return card;
}

// ─── WALLET CARD ──────────────────────────────────────────────────────────────
function buildWalletCard(showFundBtn=true) {
  const card = el('div', {className:'card'});

  const header = el('div', {className:'flex-between mb16'});
  const sectionTitle = html('<div class="section-title">WALLET</div>');
  const btns = el('div', {className:'flex-gap8'});

  if (showFundBtn && STATE.group) {
    const fundBtn = el('button', {className:'btn btn-g btn-sm', onclick:()=>{ STATE.page='groups'; renderPage(); }}, '→ FUND');
    btns.append(fundBtn);
  }
  const editBtn = el('button', {className:'btn btn-gh btn-sm', id:'wallet-edit-btn'}, 'EDIT');
  btns.append(editBtn);
  header.append(sectionTitle, btns);
  card.append(header);

  const body = el('div', {id:'wallet-body'});
  renderWalletBody(body, false);
  card.append(body);

  editBtn.onclick = () => {
    const editing = editBtn.textContent === 'EDIT';
    editBtn.textContent = editing ? 'SAVE' : 'EDIT';
    if (!editing) {
      // Save all edited values
      card.querySelectorAll('.wallet-inp').forEach(inp => {
        api('PUT', `/wallet/${encodeURIComponent(inp.dataset.name)}`, { balance: +inp.value })
          .then(() => STATE.wallet = STATE.wallet.map(w => w.name===inp.dataset.name?{...w,balance:+inp.value}:w));
      });
      const newType = $('new-wallet-type');
      if (newType?.value.trim()) {
        api('POST', '/wallet', {name:newType.value.trim()}).then(()=>{
          STATE.wallet.push({name:newType.value.trim(),balance:0});
          renderWalletBody(body, false);
        });
      }
    }
    renderWalletBody(body, editing);
  };

  return card;
}

function renderWalletBody(container, editing) {
  container.innerHTML = '';
  const total = STATE.wallet.reduce((s,w)=>s+w.balance,0);

  if (!editing) {
    // Pie chart + list
    const chartWrap = el('div', {style:{display:'flex',justifyContent:'center',marginBottom:'12px'}});
    const canvas    = el('canvas', {id:'wallet-pie', style:{width:'160px',height:'160px'}});
    chartWrap.append(canvas);
    container.append(chartWrap);

    const pieData = STATE.wallet.filter(w=>w.balance>0);
    setTimeout(() => {
      const ex = STATE.charts['wallet-pie']; if(ex) ex.destroy();
      const ctx  = $('wallet-pie')?.getContext('2d');
      if (!ctx) return;
      STATE.charts['wallet-pie'] = new Chart(ctx, {
        type:'doughnut',
        data:{ labels:pieData.map(w=>w.name), datasets:[{ data:pieData.map(w=>w.balance), backgroundColor:pieData.map((_,i)=>SLICE_COLORS[i%SLICE_COLORS.length]), borderWidth:0 }] },
        options:{ responsive:false, plugins:{ legend:{ display:false } }, cutout:'65%' }
      });
    }, 50);

    container.append(html(`<div style="text-align:center;font-family:Orbitron,sans-serif;font-size:22px;color:#00ff88;margin-bottom:12px">$${total.toLocaleString()}</div>`));
    STATE.wallet.forEach((w) => {
      const pieIdx = pieData.findIndex(p=>p.name===w.name);
      const color  = pieIdx>=0 ? SLICE_COLORS[pieIdx%SLICE_COLORS.length] : '#64748b';
      container.append(html(`
        <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--bdr)">
          <div class="flex-gap8"><div style="width:8px;height:8px;border-radius:50%;background:${color}"></div><span class="f12">${w.name}</span></div>
          <span class="f12" style="color:${color}">$${w.balance.toLocaleString()}</span>
        </div>
      `));
    });
  } else {
    // Edit mode
    STATE.wallet.forEach((w,i) => {
      const row = el('div', {className:'flex-gap8', style:{marginBottom:'8px'}});
      const dot = el('div', {style:{width:'8px',height:'8px',borderRadius:'50%',background:SLICE_COLORS[i%SLICE_COLORS.length],flexShrink:'0'}});
      const name = el('span', {className:'f12', style:{width:'80px',flexShrink:'0',color:SLICE_COLORS[i%SLICE_COLORS.length]}}, w.name);
      const inp  = el('input', {className:'inp wallet-inp', type:'number', value:w.balance, 'data-name':w.name});
      const del  = el('button', {className:'btn btn-r btn-sm', style:{flexShrink:'0'}, onclick:()=>{
        api('DELETE',`/wallet/${encodeURIComponent(w.name)}`).then(()=>{
          STATE.wallet = STATE.wallet.filter(x=>x.name!==w.name);
          renderWalletBody(container, true);
        });
      }}, '✕');
      if (STATE.wallet.length > 1) row.append(dot, name, inp, del);
      else row.append(dot, name, inp);
      container.append(row);
    });
    const addRow = el('div', {className:'flex-gap8', style:{marginTop:'8px'}});
    const newInp = el('input', {className:'inp', id:'new-wallet-type', placeholder:'New type (e.g. Trading...)'});
    const addBtn = el('button', {className:'btn btn-g btn-sm', onclick:()=>{
      const v = newInp.value.trim();
      if(!v) return;
      api('POST','/wallet',{name:v}).then(()=>{ STATE.wallet.push({name:v,balance:0}); renderWalletBody(container,true); newInp.value=''; });
    }}, '+ ADD');
    addRow.append(newInp, addBtn);
    container.append(addRow);
  }
}

// ─── HEATMAP ──────────────────────────────────────────────────────────────────
function buildHeatmap() {
  const card = el('div', {className:'card'});
  card.innerHTML = '<div class="section-title mb16">ACTIVITY HEATMAP</div>';

  const dayMap = {};
  STATE.transactions.forEach(t => { dayMap[t.date]=(dayMap[t.date]||0)+t.amount; });

  const days = [...Array(84)].map((_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-(83-i));
    const key=localDateStr(d);
    return {key,val:dayMap[key]||0,label:d.getDate()};
  });

  const grid = el('div', {className:'heatmap-grid'});
  const info = el('div', {style:{marginTop:'10px',fontSize:'12px',minHeight:'18px'}});

  days.forEach(d => {
    let bg='rgba(255,255,255,.05)';
    if(d.val>0) bg=`rgba(0,255,136,${Math.min(.2+d.val/500*.8,1)})`;
    else if(d.val<0) bg=`rgba(255,51,102,${Math.min(.2+Math.abs(d.val)/500*.8,1)})`;

    const cell = el('div', {className:'heat-day', style:{background:bg}});
    cell.innerHTML = `<span>${d.label}</span>${d.val!==0?`<span class="amt" style="color:${d.val>0?'#00ff88':'#ff3366'}">${d.val>0?'+':''}${Math.round(d.val)}</span>`:''}`;
    cell.onmouseenter = () => { if(d.val!==0) { info.style.color=d.val>0?'#00ff88':'#ff3366'; info.textContent=`${d.key}: ${fmt(d.val)}`; }};
    cell.onmouseleave = () => { info.textContent=''; };
    grid.append(cell);
  });

  card.append(grid, info);
  card.append(html(`
    <div class="flex-gap8 mt12 f11 mut">
      <span>● <span style="color:#00ff88">Profit</span></span>
      <span>● <span style="color:#ff3366">Loss</span></span>
      <span>● No activity</span>
    </div>
  `));
  return card;
}

// ─── TRANSACTION LIST ─────────────────────────────────────────────────────────
let txFilter = 'all';
function buildTxList() {
  const card = el('div', {className:'card'});

  const header = el('div', {className:'flex-between mb16'});
  header.append(html('<div class="section-title">ENTRIES</div>'));
  const tabs = el('div', {className:'flex-gap8'});
  ['all','profit','loss'].forEach(f => {
    const b = el('button', {className:`ptab ${txFilter===f?'active':''}`, onclick:()=>{ txFilter=f; txPage=0; body.replaceWith(buildTxBody()); }}, f.toUpperCase());
    tabs.append(b);
  });
  header.append(tabs);
  card.append(header);

  const body = buildTxBody();
  card.append(body);
  return card;
}

let txPage = 0;
const TX_PAGE_SIZE = 50;

function buildTxBody() {
  const wrap   = el('div', {id:'tx-body', style:{maxHeight:'340px',overflowY:'auto'}, className:'sh'});
  const sorted = [...STATE.transactions].sort((a,b)=>b.date.localeCompare(a.date)||(b.created_at||'').localeCompare(a.created_at||''));
  const items  = txFilter==='all'?sorted:sorted.filter(t=>txFilter==='profit'?t.amount>0:t.amount<0);

  if (!items.length) { wrap.append(html('<div class="text-center mut f13" style="padding:30px">No entries yet.</div>')); return wrap; }

  const start = txPage * TX_PAGE_SIZE;
  const page  = items.slice(start, start + TX_PAGE_SIZE);

  page.forEach(t => {
    const row = el('div', {className:'list-row', style:{border:'1px solid var(--bdr)',marginBottom:'6px'}});
    const icon = el('div', {className:`icon-box ${t.amount>=0?'green':'red'}`}, t.amount>=0?'▲':'▼');
    const info = el('div', {style:{flex:'1'}});
    info.innerHTML = `<div class="f13 bold">${t.category}</div><div class="f11 mut">${t.date}${t.note?` · ${t.note}`:''} · ${t.wallet}</div>`;
    const amt  = html(`<div style="font-family:Orbitron,sans-serif;font-size:15px;color:${t.amount>=0?'#00ff88':'#ff3366'}">${fmt(t.amount)}</div>`);
    const del  = el('button', {className:'btn btn-gh btn-sm', style:{color:'#64748b'}, onclick:async()=>{
      await api('DELETE',`/transactions/${t.id}`);
      STATE.transactions = STATE.transactions.filter(x=>x.id!==t.id);
      renderPage();
    }}, '✕');
    row.append(icon, info, amt, del);
    wrap.append(row);
  });

  // Pagination controls
  if (items.length > TX_PAGE_SIZE) {
    const nav = el('div', {className:'flex-between', style:{padding:'10px 0 4px',borderTop:'1px solid var(--bdr)',marginTop:'6px'}});
    const info = el('span', {className:'f11 mut'}, `${start+1}–${Math.min(start+TX_PAGE_SIZE, items.length)} of ${items.length}`);
    const btns = el('div', {className:'flex-gap8'});
    if (txPage > 0) {
      const prev = el('button', {className:'btn btn-gh btn-sm', onclick:()=>{ txPage--; wrap.replaceWith(buildTxBody()); }}, '← PREV');
      btns.append(prev);
    }
    if (start + TX_PAGE_SIZE < items.length) {
      const next = el('button', {className:'btn btn-gh btn-sm', onclick:()=>{ txPage++; wrap.replaceWith(buildTxBody()); }}, 'NEXT →');
      btns.append(next);
    }
    nav.append(info, btns);
    wrap.append(nav);
  }

  return wrap;
}


// ─── IMPORT EXCEL MODAL ───────────────────────────────────────────────────────
function showImportModal() {
  // Load SheetJS if not already loaded
  if (!window.XLSX) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => _openImportModal();
    document.head.append(s);
  } else {
    _openImportModal();
  }
}

function _openImportModal() {
  const overlay = el('div', {className:'overlay', onclick:e=>{ if(e.target===overlay) overlay.remove(); }});
  const modal   = el('div', {className:'modal slide'});
  modal.innerHTML = `<div class="modal-title nb">IMPORT ENTRIES</div><div class="modal-sub">Upload an Excel or CSV file with columns: Datum, Bedrag, Type</div>`;

  const fileInp = el('input', {type:'file', accept:'.xlsx,.xls,.csv', className:'inp', style:{marginBottom:'12px',padding:'10px'}});
  const preview = el('div', {id:'import-preview', style:{maxHeight:'200px',overflowY:'auto',marginBottom:'12px'}});
  modal.append(fileInp, preview);

  let parsedRows = [];

  fileInp.onchange = () => {
    const file = fileInp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const wb   = XLSX.read(e.target.result, {type:'binary'});
      const ws   = wb.Sheets[wb.SheetNames[0]];

      // Converteer Excel serienummer naar YYYY-MM-DD zonder Date objecten
      // zodat timezone nooit een rol speelt
      function excelSerialToDate(serial) {
        // Excel epoch: 1 jan 1900 = dag 1 (met de bekende leap year bug)
        const days = Math.floor(serial) - (serial >= 60 ? 2 : 1);
        let y = 1900, d = days;
        while (true) {
          const leap = (y%4===0&&y%100!==0)||y%400===0;
          const diy = leap ? 366 : 365;
          if (d < diy) break;
          d -= diy; y++;
        }
        const months = [31,((y%4===0&&y%100!==0)||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
        let m = 0;
        while (d >= months[m]) { d -= months[m]; m++; }
        return `${y}-${String(m+1).padStart(2,'0')}-${String(d+1).padStart(2,'0')}`;
      }

      // Haal de raw cel waarden op (niet geformatteerde strings)
      const headers = {};
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({r: range.s.r, c})];
        if (cell) headers[c] = String(cell.v).trim();
      }

      // Verwerk rijen
      parsedRows = [];
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        const r = {};
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({r: row, c})];
          const hdr  = headers[c];
          if (hdr && cell) r[hdr] = cell;
        }

        const datCell = r['Datum'] || r['Date'] || r['datum'] || r['date'];
        const amtCell = r['Bedrag'] || r['Amount'] || r['bedrag'] || r['amount'];
        const typCell = r['Type'] || r['Category'] || r['type'] || r['category'];
        const walCell = r['Wallet'] || r['wallet'];
        const notCell = r['Note'] || r['Notitie'] || r['note'];

        if (!datCell || !amtCell) continue;

        // Datum: als het een nummer is = Excel serienummer, anders tekst parsen
        let date;
        if (datCell.t === 'n') {
          date = excelSerialToDate(datCell.v);
        } else {
          date = parseDate(String(datCell.v).trim());
        }
        if (!date) continue;

        const rawAmt = String(amtCell.v || '').replace(',','.');
        const amount = parseFloat(rawAmt) || 0;
        if (amount === 0) continue;

        parsedRows.push({
          date,
          amount,
          category: typCell ? String(typCell.v).trim() : 'Other',
          wallet:   walCell ? String(walCell.v).trim() : (STATE.wallet[0]?.name || 'Cash'),
          note:     notCell ? String(notCell.v).trim() : '',
        });
      }

      preview.innerHTML = '';
      if (!parsedRows.length) {
        preview.innerHTML = '<div class="f12 mut" style="padding:10px">No valid rows found. Check column names: Datum, Bedrag, Type</div>';
        return;
      }
      const skipped = rows.length - parsedRows.length;
      const info = el('div', {className:'f11 mut', style:{marginBottom:'6px'}});
      info.textContent = `${parsedRows.length} rijen gevonden${skipped ? ` (${skipped} overgeslagen — ongeldige datum of bedrag 0)` : ''}`;
      preview.append(info);
      const table = el('table', {style:{width:'100%',borderCollapse:'collapse',fontSize:'11px'}});
      table.innerHTML = '<tr style="color:#64748b"><th style="text-align:left;padding:4px">Datum (geparsed)</th><th style="text-align:left;padding:4px">Bedrag</th><th style="text-align:left;padding:4px">Type</th></tr>';
      parsedRows.slice(0,20).forEach(r => {
        const tr = el('tr', {style:{borderBottom:'1px solid var(--bdr)'}});
        tr.innerHTML = `<td style="padding:4px">${r.date}</td><td style="padding:4px;color:${r.amount>=0?'#00ff88':'#ff3366'}">${r.amount>=0?'+':''}${r.amount}</td><td style="padding:4px">${r.category}</td>`;
        table.append(tr);
      });
      if (parsedRows.length > 20) table.append(el('tr', {}, el('td', {colspan:'3', style:{padding:'4px',color:'#64748b'}}, `...en nog ${parsedRows.length-20} meer rijen`)));
      preview.append(table);
    };
    reader.readAsBinaryString(file);
  };

  const btnRow = el('div', {className:'form-row'});
  const cancel = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>overlay.remove()}, 'CANCEL');
  const submit = el('button', {className:'btn btn-g', style:{flex:'2'}}, 'IMPORT ALL');

  submit.onclick = async () => {
    if (!parsedRows.length) return toast('Error', 'No rows to import');
    submit.disabled = true;
    submit.textContent = `Importing 0/${parsedRows.length}...`;
    let done = 0, errors = 0;

    // Add unknown categories first
    const knownCats = new Set(STATE.categories);
    const newCats   = [...new Set(parsedRows.map(r=>r.category))].filter(c=>!knownCats.has(c));
    for (const c of newCats) {
      try { await api('POST', '/categories', {name:c}); STATE.categories.push(c); } catch {}
    }

    // Add unknown wallets
    const knownWals = new Set(STATE.wallet.map(w=>w.name));
    const newWals   = [...new Set(parsedRows.map(r=>r.wallet))].filter(w=>!knownWals.has(w));
    for (const w of newWals) {
      try { await api('POST', '/wallet', {name:w}); STATE.wallet.push({name:w,balance:0}); } catch {}
    }

    const batchSize = 10;
    for (let i = 0; i < parsedRows.length; i++) {
      try {
        const tx = await api('POST', '/transactions', parsedRows[i]);
        STATE.transactions.unshift(tx);
        done++;
        if (done % batchSize === 0) submit.textContent = `Importing ${done}/${parsedRows.length}...`;
      } catch { errors++; }
    }

    overlay.remove();
    toast('Import Done', `${done} entries imported${errors?`, ${errors} failed`:''}`);
    await loadAll();
    STATE.page = 'dashboard';
    currentPeriod = 'total';
    renderPage();
  };

  btnRow.append(cancel, submit);
  modal.append(btnRow);
  overlay.append(modal);
  document.body.append(overlay);
}

// ─── ADD TRANSACTION MODAL ────────────────────────────────────────────────────
function showAddTxModal() {
  const overlay = el('div', {className:'overlay', onclick:e=>{ if(e.target===overlay) overlay.remove(); }});
  const modal   = el('div', {className:'modal slide'});

  modal.innerHTML = `<div class="modal-title nb">NEW ENTRY</div><div class="modal-sub">Record a profit or loss</div>`;

  let txType = 'profit';
  const typeRow = el('div', {className:'form-row mb12'});
  ['profit','loss'].forEach(t => {
    const b = el('button', {className:`btn ${t==='profit'?'btn-g':'btn-r'} ${txType===t?'':'btn-o'}`, style:{flex:'1'}, onclick:()=>{
      txType=t; typeRow.querySelectorAll('.btn').forEach((x,i)=>{ x.className=`btn ${i===0?(txType==='profit'?'btn-g':'btn-o'):(txType==='loss'?'btn-r':'btn-o')}`; x.style.flex='1'; });
    }}, t==='profit'?'▲ PROFIT':'▼ LOSS');
    typeRow.append(b);
  });
  modal.append(typeRow);

  const amtInp = el('input', {className:'inp mb8', type:'number', placeholder:'Amount (USD)', style:{marginBottom:'10px'}});
  const catSel = el('select', {className:'sel', style:{marginBottom:'10px'}});
  STATE.categories.forEach(c => catSel.append(el('option', {value:c}, c)));
  const walSel = el('select', {className:'sel', style:{marginBottom:'10px'}});
  STATE.wallet.forEach(w => walSel.append(el('option', {value:w.name}, w.name)));
  const dateInp = el('input', {className:'inp', type:'date', value:todayStr(), style:{marginBottom:'10px'}});
  const noteInp = el('input', {className:'inp', placeholder:'Note (optional)', style:{marginBottom:'16px'}});

  modal.append(amtInp, catSel, walSel, dateInp, noteInp);

  const btnRow = el('div', {className:'form-row'});
  const cancel = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>overlay.remove()}, 'CANCEL');
  const submit = el('button', {className:'btn btn-g', style:{flex:'2'}}, 'RECORD');

  submit.onclick = async () => {
    if (!amtInp.value) return;
    submit.disabled = true; submit.textContent = '...';
    const amount = parseFloat(amtInp.value) * (txType==='loss'?-1:1);
    try {
      const tx = await api('POST', '/transactions', { amount, category:catSel.value, wallet:walSel.value, date:dateInp.value, note:noteInp.value });
      STATE.transactions.unshift(tx);
      toast('Entry Recorded', `${amount>=0?'+':''}$${Math.abs(amount).toFixed(2)} · ${catSel.value}`);
      overlay.remove();
      renderPage();
    } catch(e) { toast('Error', e.message); submit.disabled=false; submit.textContent='RECORD'; }
  };

  btnRow.append(cancel, submit);
  modal.append(btnRow);
  overlay.append(modal);
  document.body.append(overlay);
  setTimeout(()=>amtInp.focus(), 100);
}

// ─── CHARTS PAGE ──────────────────────────────────────────────────────────────
function renderCharts(container) {
  const col = el('div', {className:'flex-col', style:{gap:'20px'}});
  col.append(buildIncomeChartCard());

  const row = el('div', {className:'g2'});
  row.append(buildCategoryChart(), buildWalletCard(false));
  col.append(row);
  col.append(buildHeatmap());
  container.append(col);
}

function buildCategoryChart() {
  const card = el('div', {className:'card', style:{padding:'20px 20px 14px'}});
  card.innerHTML = '<div class="section-title mb12">BY CATEGORY</div>';
  const chartWrap2 = el('div', {style:{position:'relative',height:'200px',width:'100%'}});
  const canvas = el('canvas', {id:'cat-chart'});
  chartWrap2.append(canvas);
  card.append(chartWrap2);

  setTimeout(() => {
    const ex = STATE.charts['cat-chart']; if(ex) ex.destroy();
    const map = {};
    STATE.categories.forEach(c=>{ map[c]=0; });
    STATE.transactions.forEach(t=>{ map[t.category]=(map[t.category]||0)+t.amount; });
    const data = Object.entries(map).filter(([,v])=>v!==0);
    const ctx  = $('cat-chart')?.getContext('2d');
    if (!ctx) return;
    STATE.charts['cat-chart'] = new Chart(ctx, {
      type: 'bar',
      data: { labels:data.map(([k])=>k.slice(0,8)), datasets:[{ data:data.map(([,v])=>+v.toFixed(2)), backgroundColor:data.map(([,v])=>v>=0?'rgba(0,255,136,.7)':'rgba(255,51,102,.7)'), borderRadius:4 }] },
      options: { responsive:false, plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ color:'#64748b' }, grid:{ color:'rgba(255,255,255,.04)' } }, y:{ ticks:{ color:'#64748b', callback:v=>`$${v}` }, grid:{ color:'rgba(255,255,255,.04)' } } } }
    });
  }, 50);
  return card;
}

// ─── WALLET PAGE ──────────────────────────────────────────────────────────────
function renderWalletPage(container) {
  const col = el('div', {className:'flex-col', style:{gap:'20px'}});
  col.append(buildWalletCard(true));

  // Crypto prices
  const cryptoCard = el('div', {className:'card'});
  cryptoCard.innerHTML = '<div class="section-title mb16">CRYPTO LIVE PRICES</div>';
  [
    {sym:'BTC',name:'Bitcoin',  price:cryptoPrices.BTC},
    {sym:'SOL',name:'Solana',   price:cryptoPrices.SOL},
    {sym:'USDC',name:'USD Coin',price:cryptoPrices.USDC},
  ].forEach(c => {
    const row = html(`
      <div class="flex-between" style="padding:14px 0;border-bottom:1px solid var(--bdr)">
        <div class="flex-gap8">
          <div style="width:40px;height:40px;border-radius:50%;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">${c.sym[0]}</div>
          <div><div class="bold">${c.name}</div><div class="f11 mut">${c.sym}</div></div>
        </div>
        <div style="text-align:right">
          <div class="crypto-price-val" data-sym="${c.sym}" style="font-family:Orbitron,sans-serif;font-size:16px;color:#00ff88">${c.price>0?'$'+Number(c.price).toLocaleString():'Loading...'}</div>
          <div class="pulse f11 mut">LIVE</div>
        </div>
      </div>
    `);
    cryptoCard.append(row);
  });
  col.append(cryptoCard);
  container.append(col);
  // Refresh prices immediately when wallet page is opened
  fetchCryptoPrices();
}

// ─── GROUPS PAGE ──────────────────────────────────────────────────────────────
function renderGroupsPage(container) {
  const col = el('div', {className:'flex-col', style:{gap:'20px'}});

  if (!STATE.group) {
    col.append(buildNoGroupCard());
  } else {
    col.append(buildFundCard(), buildDepositActions(), buildPaymentDetailsCard(), buildGroupInfoCard());
  }
  container.append(col);
}

function buildNoGroupCard() {
  const card = el('div', {className:'card'});
  card.innerHTML = `<div class="section-title mb16">GROUPS</div><div class="mut f12 mb20" style="line-height:1.8">Not in a group yet.<br><span style="color:#00d4ff;font-size:11px">You can only be in one group at a time.</span></div>`;

  let mode = 'none';
  const body = el('div');

  function renderMode() {
    body.innerHTML = '';
    if (mode === 'none') {
      const row = el('div', {className:'form-row'});
      const createBtn = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>{ mode='create'; renderMode(); }}, '+ CREATE');
      const joinBtn   = el('button', {className:'btn btn-g', style:{flex:'1'}, onclick:()=>{ mode='join';   renderMode(); }}, 'JOIN');
      row.append(createBtn, joinBtn);
      body.append(row);
    } else if (mode === 'create') {
      const inp = el('input', {className:'inp mb8', placeholder:'Group name'});
      const err = el('div', {className:'err mb8'});
      const row = el('div', {className:'form-row'});
      const back = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>{ mode='none'; renderMode(); }}, 'CANCEL');
      const go   = el('button', {className:'btn btn-g', style:{flex:'2'}}, 'CREATE');
      go.onclick = async () => {
        go.disabled=true; go.textContent='...';
        try { STATE.group = await api('POST','/groups',{name:inp.value.trim()}); STATE.deposits=[]; STATE.messages=[]; STATE.socket?.emit('group:change'); renderPage(); }
        catch(e){ err.textContent=e.message; go.disabled=false; go.textContent='CREATE'; }
      };
      inp.addEventListener('keydown', e=>{ if(e.key==='Enter') go.click(); });
      row.append(back, go);
      body.append(inp, err, row);
    } else {
      const inp = el('input', {className:'inp mb8', placeholder:'Invite code (e.g. AB12CD)'});
      inp.oninput = () => inp.value = inp.value.toUpperCase();
      const err = el('div', {className:'err mb8'});
      const row = el('div', {className:'form-row'});
      const back = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>{ mode='none'; renderMode(); }}, 'CANCEL');
      const go   = el('button', {className:'btn btn-g', style:{flex:'2'}}, 'JOIN');
      go.onclick = async () => {
        go.disabled=true; go.textContent='...';
        try { STATE.group = await api('POST','/groups/join',{code:inp.value.trim()}); STATE.deposits=await api('GET','/deposits'); STATE.messages=await api('GET','/messages'); STATE.socket?.emit('group:change'); toast('Joined!',`Welcome to "${STATE.group.name}"`); renderPage(); }
        catch(e){ err.textContent=e.message; go.disabled=false; go.textContent='JOIN'; }
      };
      inp.addEventListener('keydown', e=>{ if(e.key==='Enter') go.click(); });
      row.append(back, go);
      body.append(inp, err, row);
    }
  }
  renderMode();
  card.append(body);
  return card;
}

function buildFundCard() {
  const confirmed = STATE.deposits.filter(d=>d.status==='confirmed');
  const pending   = STATE.deposits.filter(d=>d.status==='pending');
  const fundTotal = confirmed.reduce((s,d)=>s+d.amount,0);
  const memberTotals = {};
  confirmed.forEach(d=>{ memberTotals[d.user_id]=(memberTotals[d.user_id]||0)+d.amount; });

  const card = el('div', {className:'card fund-card'});
  card.onclick = () => showBreakdownModal();

  const topRow = el('div', {className:'flex-between mb8'});
  topRow.innerHTML = `<div class="section-title">INVESTMENT FUND · ${STATE.group.name}</div>`;
  const right = el('div', {className:'flex-gap8'});
  if (pending.length>0) right.append(html(`<span class="badge badge-y">${pending.length} PENDING</span>`));
  right.append(html('<span class="f11 ng">TAP →</span>'));
  topRow.append(right);
  card.append(topRow);

  card.append(html(`
    <div style="font-family:Orbitron,sans-serif;font-size:42px;font-weight:900;color:#00ff88;text-shadow:0 0 20px rgba(0,255,136,.3)">$${fundTotal.toLocaleString('en',{minimumFractionDigits:2})}</div>
    <div class="f12 mut mt8">${confirmed.length} confirmed deposit${confirmed.length!==1?'s':''} · tap to see breakdown</div>
  `));

  // Member bars
  if (STATE.group.members.length > 0) {
    const barsRow = el('div', {className:'flex-gap8 mt16', style:{flexWrap:'wrap'}});
    STATE.group.members.forEach((m,i) => {
      const contrib = memberTotals[m.id]||0;
      const pct     = fundTotal>0?contrib/fundTotal*100:0;
      const memberCol = el('div', {style:{flex:'1',minWidth:'70px'}});
      memberCol.innerHTML = `<div class="f11 mut mb4">${(m.display_name||m.username).split(' ')[0]}</div><div class="prog"><div class="prog-f" style="width:${pct}%;background:${SLICE_COLORS[i%SLICE_COLORS.length]}"></div></div><div class="f11 mt4" style="color:${SLICE_COLORS[i%SLICE_COLORS.length]}">$${contrib.toFixed(0)}</div>`;
      barsRow.append(memberCol);
    });
    card.append(barsRow);
  }
  return card;
}

function buildDepositActions() {
  const isAdmin = STATE.group.admin_id === STATE.user.id;
  const row = el('div', {className:'form-row'});
  const depBtn = el('button', {className:'btn btn-g glow-g', style:{flex:'2'}, onclick:showDepositModal}, '↗ DEPOSIT TO FUND');
  row.append(depBtn);
  if (isAdmin) {
    const payBtn = el('button', {className:'btn btn-b', style:{flex:'1'}, onclick:showPaymentSettingsModal}, '⚙ PAYMENT');
    row.append(payBtn);
  }
  return row;
}

function buildPaymentDetailsCard() {
  const isAdmin = STATE.group.admin_id === STATE.user.id;
  if (!STATE.group.paypal) {
    if (!isAdmin) return el('div'); // hide for non-admin
    return html(`<div style="padding:14px;background:rgba(255,230,0,.05);border:1px solid rgba(255,230,0,.2);border-radius:10px;font-size:12px;color:#ffe600">⚠ No payment details. Click PAYMENT to add your PayPal address.</div>`);
  }
  const card = el('div', {className:'card', style:{borderColor:'rgba(0,212,255,.2)',background:'rgba(0,212,255,.03)'}});
  card.innerHTML = '<div class="section-title mb12 nb">PAYMENT DETAILS</div>';
  const copyRow = el('div', {className:'copy-row'});
  const val     = el('span', {className:'copy-val'}, `💳 ${STATE.group.paypal}`);
  const copyBtn = el('button', {className:'btn btn-gh btn-sm'}, 'COPY');
  copyBtn.onclick = () => copyText(STATE.group.paypal, copyBtn);

  const ppLink  = STATE.group.paypal.includes('paypal.me')
    ? `https://${STATE.group.paypal.replace(/https?:\/\//,'')}`
    : `https://paypal.me/${STATE.group.paypal}`;
  const openBtn = el('a', {href:ppLink, target:'_blank', className:'btn btn-gh btn-sm', style:{textDecoration:'none'}}, 'OPEN ↗');

  copyRow.append(val, openBtn, copyBtn);
  card.append(copyRow);
  if (STATE.group.pay_note) card.append(html(`<div class="f12 mut mt8">📝 ${STATE.group.pay_note}</div>`));
  return card;
}

function buildGroupInfoCard() {
  const isAdmin = STATE.group.admin_id === STATE.user.id;
  const confirmed = STATE.deposits.filter(d=>d.status==='confirmed');
  const memberTotals = {};
  confirmed.forEach(d=>{ memberTotals[d.user_id]=(memberTotals[d.user_id]||0)+d.amount; });

  const card = el('div', {className:'card'});
  card.innerHTML = `<div class="section-title mb16">GROUP INFO</div>`;

  const infoBox = el('div', {style:{padding:'12px 16px',background:'rgba(0,212,255,.05)',border:'1px solid rgba(0,212,255,.15)',borderRadius:'10px',marginBottom:'16px'}});
  infoBox.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-family:Orbitron,sans-serif;font-size:18px;color:#00d4ff">${STATE.group.name}</div>
        <div class="f12 mut mt4">Invite code: <span style="color:#00ff88;font-weight:700;letter-spacing:3px;font-size:15px">${STATE.group.code}</span></div>
        <div class="f11 mut mt4">${STATE.group.members.length} member${STATE.group.members.length!==1?'s':''}</div>
      </div>
      ${isAdmin?'<span class="badge badge-g">ADMIN</span>':''}
    </div>
  `;
  card.append(infoBox);

  STATE.group.members.forEach((m,i) => {
    const row = el('div', {className:'list-row', style:{border:'1px solid var(--bdr)',marginBottom:'6px'}});
    const avatar = el('div', {className:'avatar-circle'}, m.avatar||m.username[0].toUpperCase());
    const info   = el('div', {style:{flex:'1'}});
    info.innerHTML = `<div class="f13">${m.display_name||m.username} ${m.id===STATE.user.id?'<span class="nb f11">YOU</span>':''}</div><div class="f11" style="color:#00ff88">@${m.username} · $${(memberTotals[m.id]||0).toFixed(2)}</div>`;
    row.append(avatar, info);
    if (m.id === STATE.group.admin_id) row.append(html('<span class="badge badge-g">ADMIN</span>'));
    if (isAdmin && m.id !== STATE.user.id) {
      const kickBtn = el('button', {className:'btn btn-r btn-sm', onclick:async()=>{
        await api('DELETE','/groups/leave',{targetUserId:m.id});
        STATE.group.members = STATE.group.members.filter(x=>x.id!==m.id);
        STATE.socket?.emit('group:change');
        toast('Member removed','');
        renderPage();
      }}, 'KICK');
      row.append(kickBtn);
    }
    card.append(row);
  });

  const leaveBtn = el('button', {
    className:'btn btn-o mt12 btn-full',
    style:{color:'#ff3366',borderColor:'rgba(255,51,102,.3)'},
    onclick: async () => {
      await api('DELETE','/groups/leave');
      STATE.group=null; STATE.deposits=[]; STATE.socket?.emit('group:change');
      toast('Left group',''); renderPage();
    }
  }, isAdmin && STATE.group.members.length===1 ? 'DELETE GROUP' : 'LEAVE GROUP');
  card.append(leaveBtn);
  return card;
}

// ─── DEPOSIT MODAL ────────────────────────────────────────────────────────────
function showDepositModal() {
  let step=1, chosenAmount=0, chosenSource='';
  const overlay = el('div', {className:'overlay', onclick:e=>{ if(e.target===overlay) overlay.remove(); }});
  const modal   = el('div', {className:'modal slide'});
  overlay.append(modal);
  document.body.append(overlay);

  function renderStep() {
    modal.innerHTML='';
    if (step===1) {
      modal.innerHTML = `<div class="modal-title ng">DEPOSIT TO FUND</div><div class="modal-sub">Transfer into <span style="color:#00ff88">${STATE.group.name}</span></div>`;
      const srcSel = el('select', {className:'sel mb8'});
      STATE.wallet.forEach(w => srcSel.append(el('option', {value:w.name}, `${w.name} — $${w.balance.toFixed(2)} available`)));
      const amtInp = el('input', {className:'inp mb8', type:'number', placeholder:'Amount (USD)'});
      const noteInp= el('input', {className:'inp mb16', placeholder:'Reference / note (optional)'});
      const err    = el('div', {className:'err mb8'});
      modal.append(html('<div class="label mb8">FROM WALLET</div>'), srcSel, html('<div class="label mb8">AMOUNT</div>'), amtInp, noteInp, err);

      const row = el('div', {className:'form-row'});
      const back = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>overlay.remove()}, 'CANCEL');
      const next = el('button', {className:'btn btn-g', style:{flex:'2'}}, 'NEXT → PAYMENT');
      next.onclick = () => {
        const avl = STATE.wallet.find(w=>w.name===srcSel.value)?.balance||0;
        const amt = parseFloat(amtInp.value)||0;
        if (amt<=0||amt>avl) { err.textContent=amt<=0?'Enter an amount':'Insufficient balance'; return; }
        chosenAmount=amt; chosenSource=srcSel.value;
        step=2; renderStep();
      };
      row.append(back, next);
      modal.append(row);
    } else if (step===2) {
      modal.innerHTML = `<div class="modal-title ny">SEND PAYMENT</div><div class="modal-sub">Send exactly <span style="color:#00ff88;font-size:15px;font-weight:700">$${chosenAmount.toFixed(2)}</span> then click "I've Paid"</div>`;
      modal.append(html(`<div style="text-align:center;padding:18px;background:rgba(0,255,136,.05);border:1px solid rgba(0,255,136,.2);border-radius:12px;margin-bottom:20px"><div class="section-title mb8">AMOUNT TO SEND</div><div style="font-family:Orbitron,sans-serif;font-size:36px;font-weight:900;color:#00ff88">$${chosenAmount.toFixed(2)}</div></div>`));

      if (STATE.group.paypal) {
        const copyRow = el('div', {className:'copy-row'});
        const val     = el('span', {className:'copy-val'}, `💳 ${STATE.group.paypal}`);
        const copyBtn = el('button', {className:'btn btn-gh btn-sm'}, 'COPY');
        copyBtn.onclick = () => copyText(STATE.group.paypal, copyBtn);
        const ppLink  = STATE.group.paypal.includes('paypal.me')
          ? `https://${STATE.group.paypal.replace(/https?:\/\//,'')}/${chosenAmount.toFixed(2)}`
          : `https://paypal.me/${STATE.group.paypal}/${chosenAmount.toFixed(2)}`;
        const openBtn = el('a', {href:ppLink, target:'_blank', className:'btn btn-gh btn-sm', style:{textDecoration:'none'}}, 'OPEN ↗');
        copyRow.append(val, openBtn, copyBtn);
        modal.append(html('<div class="label mb8">💳 PAYPAL</div>'), copyRow);
      } else {
        modal.append(html('<div style="padding:14px;background:rgba(255,230,0,.05);border:1px solid rgba(255,230,0,.2);border-radius:10px;color:#ffe600;font-size:12px;margin-bottom:16px">⚠ No PayPal set. Ask the admin to add payment details.</div>'));
      }
      if (STATE.group.pay_note) modal.append(html(`<div style="padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid var(--bdr);border-radius:10px;font-size:13px;margin-bottom:16px">📝 ${STATE.group.pay_note}</div>`));

      const row = el('div', {className:'form-row'});
      const back = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>{ step=1; renderStep(); }}, '← BACK');
      const paid = el('button', {className:'btn btn-y', style:{flex:'2'}}, "✓ I'VE PAID");
      paid.onclick = () => { step=3; renderStep(); };
      row.append(back, paid);
      modal.append(row);
    } else {
      modal.innerHTML = `<div class="modal-title ny">CONFIRM DEPOSIT</div><div class="modal-sub">Will be <span style="color:#ffe600">PENDING</span> until admin confirms receipt.</div>`;
      modal.append(html(`
        <div style="padding:16px;background:rgba(255,230,0,.05);border:1px solid rgba(255,230,0,.2);border-radius:12px;margin-bottom:20px">
          <div class="flex-between mb8"><span class="f12 mut">Amount</span><span style="font-family:Orbitron,sans-serif;font-size:15px;color:#00ff88">$${chosenAmount.toFixed(2)}</span></div>
          <div class="flex-between mb8"><span class="f12 mut">From</span><span class="f12">${chosenSource}</span></div>
          <div class="flex-between"><span class="f12 mut">Via</span><span class="f12 nb">PayPal</span></div>
        </div>
      `));
      const row = el('div', {className:'form-row'});
      const back = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>{ step=2; renderStep(); }}, '← BACK');
      const conf = el('button', {className:'btn btn-g', style:{flex:'2'}}, 'SUBMIT DEPOSIT');
      conf.onclick = async () => {
        conf.disabled=true; conf.textContent='...';
        try {
          const dep = await api('POST','/deposits',{amount:chosenAmount,source:chosenSource,method:'PayPal'});
          STATE.deposits.unshift(dep);
          STATE.socket?.emit('deposit:change', dep);
          toast('Deposit Submitted', `$${chosenAmount.toFixed(2)} pending admin approval`);
          overlay.remove();
          renderPage();
        } catch(e){ toast('Error',e.message); conf.disabled=false; conf.textContent='SUBMIT DEPOSIT'; }
      };
      row.append(back, conf);
      modal.append(row);
    }
  }
  renderStep();
}

// ─── PAYMENT SETTINGS MODAL ───────────────────────────────────────────────────
function showPaymentSettingsModal() {
  const overlay = el('div', {className:'overlay', onclick:e=>{ if(e.target===overlay) overlay.remove(); }});
  const modal   = el('div', {className:'modal slide'});

  modal.innerHTML = `
    <div class="modal-title nb">PAYMENT SETTINGS</div>
    <div class="modal-sub">Members see these details when depositing. <span style="color:#ffe600">Admin only.</span></div>
  `;

  const ppInp   = el('input', {className:'inp mb8', placeholder:'PayPal email or paypal.me/username', value:STATE.group.paypal||''});
  const noteInp = el('input', {className:'inp mb16', placeholder:'Note for members (optional)', value:STATE.group.pay_note||''});
  modal.append(html('<div class="label mb8">💳 PAYPAL</div>'), ppInp, html('<div class="label mb8">📝 NOTE FOR MEMBERS</div>'), noteInp);

  const row = el('div', {className:'form-row'});
  const cancel = el('button', {className:'btn btn-o', style:{flex:'1'}, onclick:()=>overlay.remove()}, 'CANCEL');
  const save   = el('button', {className:'btn btn-g', style:{flex:'2'}}, 'SAVE');
  save.onclick = async () => {
    save.disabled=true; save.textContent='...';
    await api('PUT','/groups/payment',{paypal:ppInp.value.trim(),pay_note:noteInp.value.trim()});
    STATE.group.paypal   = ppInp.value.trim();
    STATE.group.pay_note = noteInp.value.trim();
    STATE.socket?.emit('group:change');
    toast('Payment settings saved','');
    overlay.remove();
    renderPage();
  };
  row.append(cancel, save);
  modal.append(row);
  overlay.append(modal);
  document.body.append(overlay);
}

// ─── BREAKDOWN MODAL ──────────────────────────────────────────────────────────
function showBreakdownModal() {
  const isAdmin   = STATE.group.admin_id === STATE.user.id;
  const confirmed = STATE.deposits.filter(d=>d.status==='confirmed');
  const pending   = STATE.deposits.filter(d=>d.status==='pending');
  const cancelled = STATE.deposits.filter(d=>d.status==='cancelled');
  const total     = confirmed.reduce((s,d)=>s+d.amount,0);

  const overlay = el('div', {className:'overlay', onclick:e=>{ if(e.target===overlay) overlay.remove(); }});
  const modal   = el('div', {className:'modal slide'});

  const header = el('div', {className:'flex-between mb8'});
  header.innerHTML = `<div class="modal-title ng">${STATE.group.name} — FUND</div>`;
  const closeBtn = el('button', {className:'btn btn-gh btn-sm', onclick:()=>overlay.remove()}, '✕');
  header.append(closeBtn);
  modal.append(header);

  // Total
  modal.append(html(`
    <div style="text-align:center;padding:22px;background:rgba(0,255,136,.05);border:1px solid rgba(0,255,136,.2);border-radius:14px;margin-bottom:20px">
      <div class="section-title mb8">CONFIRMED FUND VALUE</div>
      <div style="font-family:Orbitron,sans-serif;font-size:38px;font-weight:900;color:#00ff88;text-shadow:0 0 20px rgba(0,255,136,.4)">$${total.toLocaleString('en',{minimumFractionDigits:2})}</div>
      <div class="flex-gap8 mt12" style="justify-content:center;flex-wrap:wrap">
        <span class="badge badge-y">${pending.length} PENDING</span>
        <span class="badge badge-g">${confirmed.length} CONFIRMED</span>
        ${cancelled.length>0?`<span class="badge badge-r">${cancelled.length} CANCELLED</span>`:''}
      </div>
    </div>
  `));

  // Pending — admin actions
  if (pending.length > 0) {
    modal.append(html(`<div class="section-title ny mb12">⏳ PENDING${isAdmin?' — APPROVE OR CANCEL':''}</div>`));
    pending.forEach(d => {
      const row = el('div', {className:'dep-row pending mb8'});
      row.innerHTML = `<div class="flex-between mb8"><div><span class="f13 bold">${d.username}</span><span class="f11 mut" style="margin-left:10px">via ${d.method} · ${d.source} · ${d.date}</span>${d.note?`<div class="f11 mut mt4">${d.note}</div>`:''}</div><span style="font-family:Orbitron,sans-serif;font-size:15px;color:#ffe600">$${d.amount.toFixed(2)}</span></div>`;
      if (isAdmin) {
        const actionRow = el('div', {className:'form-row'});
        const confBtn = el('button', {className:'btn btn-g btn-sm', style:{flex:'1'}}, '✓ CONFIRM RECEIVED');
        const cancBtn = el('button', {className:'btn btn-r btn-sm', style:{flex:'1'}}, '✕ NOT RECEIVED');
        confBtn.onclick = async () => {
          const updated = await api('PUT',`/deposits/${d.id}/confirm`);
          STATE.deposits = STATE.deposits.map(x=>x.id===updated.id?updated:x);
          STATE.socket?.emit('deposit:change', updated);
          // Also update wallet state if it's our own deposit
          if (d.user_id === STATE.user.id) {
            STATE.wallet = await api('GET','/wallet');
          }
          toast('Confirmed ✓', `$${d.amount.toFixed(2)} confirmed`);
          overlay.remove(); renderPage();
        };
        cancBtn.onclick = async () => {
          const updated = await api('PUT',`/deposits/${d.id}/cancel`);
          STATE.deposits = STATE.deposits.map(x=>x.id===updated.id?updated:x);
          STATE.socket?.emit('deposit:change', updated);
          toast('Cancelled', `Deposit marked not received`);
          overlay.remove(); renderPage();
        };
        actionRow.append(confBtn, cancBtn);
        row.append(actionRow);
      } else {
        row.append(html('<div class="f11 ny mt8">Waiting for admin confirmation…</div>'));
      }
      modal.append(row);
    });
  }

  // Per member
  const byMember = {};
  STATE.group.members.forEach(m=>{ byMember[m.id]={name:m.display_name||m.username,avatar:m.avatar||m.username[0].toUpperCase(),amount:0,deps:[]}; });
  confirmed.forEach(d=>{ if(byMember[d.user_id]){byMember[d.user_id].amount+=d.amount;byMember[d.user_id].deps.push(d);} });
  const members = Object.values(byMember).filter(m=>m.amount>0).sort((a,b)=>b.amount-a.amount);

  if (members.length > 0) {
    modal.append(html('<div class="section-title mb12 mt16">MEMBER CONTRIBUTIONS</div>'));
    const list = el('div', {style:{maxHeight:'280px',overflowY:'auto'}, className:'sh'});
    members.forEach((m,i) => {
      const pct = total>0?m.amount/total*100:0;
      const row = el('div', {style:{padding:'12px 14px',borderRadius:'10px',border:'1px solid var(--bdr)',background:'rgba(255,255,255,.02)',marginBottom:'8px'}});
      row.innerHTML = `
        <div class="flex-gap8 mb8">
          <div class="avatar-circle">${m.avatar}</div>
          <div style="flex:1"><div class="f13 bold">${m.name}</div><div class="f11 mut">${m.deps.length} deposit${m.deps.length!==1?'s':''}</div></div>
          <div style="text-align:right"><div style="font-family:Orbitron,sans-serif;font-size:15px;color:#00ff88">$${m.amount.toFixed(2)}</div><div class="f11 mut">${pct.toFixed(1)}%</div></div>
        </div>
        <div class="prog"><div class="prog-f" style="width:${pct}%;background:#00ff88"></div></div>
        ${m.deps.map(d=>`<div class="flex-between f11 mut" style="padding:3px 0;border-top:1px solid rgba(255,255,255,.04);margin-top:6px"><span>${d.date}${d.note?` · ${d.note}`:''}</span><span style="color:#00ff88">+$${d.amount.toFixed(2)}</span></div>`).join('')}
      `;
      list.append(row);
    });
    modal.append(list);
  }

  if (confirmed.length===0&&pending.length===0) modal.append(html('<div class="text-center mut f13" style="padding:20px">No deposits yet. Be the first to invest!</div>'));

  overlay.append(modal);
  document.body.append(overlay);
}

// ─── CHAT PAGE ────────────────────────────────────────────────────────────────
function renderChatPage(container) {
  if (!STATE.group) { container.append(html('<div class="card text-center mut f13" style="padding:40px">Join a group to access chat</div>')); return; }

  const card = el('div', {className:'card flex-col', style:{height:'500px'}});

  // Header
  card.append(html(`<div class="section-title" style="padding-bottom:12px;border-bottom:1px solid var(--bdr);margin-bottom:12px">💬 ${STATE.group.name}</div>`));

  // Messages
  const msgArea = el('div', {className:'sh flex-col', style:{flex:'1',overflowY:'auto',gap:'10px',display:'flex',flexDirection:'column'}});
  if (!STATE.messages.length) msgArea.append(html('<div class="text-center mut f12" style="padding-top:30px">No messages yet. Say hi! 👋</div>'));

  STATE.messages.forEach(m => {
    const isMe = m.user_id === STATE.user.id;
    if (m.type==='poll') {
      let data; try { data=JSON.parse(m.content); } catch { return; }
      const totalVotes = (data.options||[]).reduce((s,o)=>s+(o.votes?.length||0),0);
      const pollDiv = el('div', {className:'poll-card'});
      pollDiv.innerHTML = `<div class="f11 mut mb8">${m.username} · POLL</div><div class="f13 bold mb12">${data.question}</div>`;
      (data.options||[]).forEach((opt,i) => {
        const pct = totalVotes?Math.round((opt.votes?.length||0)/totalVotes*100):0;
        const optDiv = el('div', {style:{marginBottom:'8px',cursor:'pointer'}, onclick:async()=>{
          await api('POST',`/messages/${m.id}/vote`,{optionIdx:i});
          STATE.messages = await api('GET','/messages');
          renderPage();
        }});
        optDiv.innerHTML = `<div class="flex-between f12 mb4"><span>${opt.text}</span><span class="mut">${pct}%</span></div><div class="prog"><div class="prog-f" style="width:${pct}%;background:${opt.votes?.includes(STATE.user.id)?'#bf5fff':'rgba(191,95,255,.4)'}"></div></div>`;
        pollDiv.append(optDiv);
      });
      pollDiv.append(html(`<div class="f11 mut mt8">${totalVotes} votes</div>`));
      msgArea.append(el('div', {}, pollDiv));
    } else {
      const wrap = el('div', {className:'flex-col', style:{alignItems:isMe?'flex-end':'flex-start'}});
      if (!isMe) wrap.append(html(`<div class="sender-name">${m.username}</div>`));
      const bubble = el('div', {className:isMe?'bubble-me':'bubble-them'});
      bubble.innerHTML = `<div class="f13">${m.content}</div><div class="bubble-time">${new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>`;
      wrap.append(bubble);
      msgArea.append(wrap);
    }
  });
  card.append(msgArea);

  // Scroll to bottom
  setTimeout(() => msgArea.scrollTop = msgArea.scrollHeight, 50);

  // Poll mode state
  let pollMode = false;

  // Input area
  const inputArea = el('div', {className:'flex-col', style:{marginTop:'12px',gap:'8px'}});

  function buildInputRow() {
    inputArea.innerHTML='';
    if (pollMode) {
      const qInp = el('input', {className:'inp', placeholder:'Poll question...'});
      const opts  = [el('input',{className:'inp',placeholder:'Option 1'}), el('input',{className:'inp',placeholder:'Option 2'})];
      const optsWrap = el('div', {className:'flex-col', style:{gap:'8px'}});
      opts.forEach(o => optsWrap.append(o));
      const addOptBtn = el('button', {className:'btn btn-gh btn-sm', onclick:()=>{ const ni=el('input',{className:'inp',placeholder:`Option ${optsWrap.children.length+1}`}); optsWrap.append(ni); }}, '+ Option');
      const row = el('div', {className:'form-row'});
      const cancel = el('button', {className:'btn btn-o btn-sm', onclick:()=>{ pollMode=false; buildInputRow(); }}, 'Cancel');
      const send   = el('button', {className:'btn btn-g btn-sm', style:{flex:'1'}}, 'Create Poll');
      send.onclick = async () => {
        const question = qInp.value.trim();
        const options  = [...optsWrap.querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);
        if (!question || options.length<2) return;
        const msg = await api('POST','/messages',{type:'poll',content:JSON.stringify({question,options:options.map(t=>({text:t}))})});
        STATE.messages.push(msg);
        STATE.socket?.emit('message:send', msg);
        pollMode=false; buildInputRow(); renderPage();
      };
      row.append(addOptBtn, cancel, send);
      inputArea.append(qInp, optsWrap, row);
    } else {
      const row   = el('div', {className:'form-row'});
      const poll  = el('button', {className:'btn btn-gh', style:{padding:'10px 12px',fontSize:'14px'}, onclick:()=>{ pollMode=true; buildInputRow(); }}, '📊');
      const msgInp= el('input', {className:'inp', placeholder:'Message...'});
      const send  = el('button', {className:'btn btn-g', style:{padding:'10px 16px'}}, '→');
      const doSend = async () => {
        if (!msgInp.value.trim()) return;
        const msg = await api('POST','/messages',{type:'text',content:msgInp.value.trim()});
        STATE.messages.push(msg);
        STATE.socket?.emit('message:send', msg);
        msgInp.value='';
        const w = el('div', {className:'flex-col', style:{alignItems:'flex-end'}});
        const b = el('div', {className:'bubble-me'});
        b.innerHTML = `<div class="f13">${msg.content}</div><div class="bubble-time">${new Date(msg.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>`;
        w.append(b); msgArea.append(w);
        msgArea.scrollTop = msgArea.scrollHeight;
      };
      msgInp.addEventListener('keydown', e=>{ if(e.key==='Enter') doSend(); });
      send.onclick = doSend;
      row.append(poll, msgInp, send);
      inputArea.append(row);
    }
  }
  buildInputRow();
  card.append(inputArea);
  container.append(card);
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
function renderLeaderboard(container) {
  const col = el('div', {className:'flex-col', style:{gap:'20px'}});

  if (STATE.group) {
    const card = el('div', {className:'card'});
    card.innerHTML = `<div class="section-title mb16">LEADERBOARD · ${STATE.group.name}</div>`;
    const confirmed = STATE.deposits.filter(d=>d.status==='confirmed');
    const medals = ['🥇','🥈','🥉'];
    STATE.group.members.forEach((m,i) => {
      const contrib = confirmed.filter(d=>d.user_id===m.id).reduce((s,d)=>s+d.amount,0);
      const row = el('div', {className:`list-row ${i===0?'gold-row':''}`, style:{marginBottom:'6px'}});
      row.innerHTML = `
        <div style="width:28px;text-align:center;font-size:${i<3?18:14}px">${medals[i]||i+1}</div>
        <div class="avatar-circle">${m.avatar||m.username[0].toUpperCase()}</div>
        <div style="flex:1">
          <div class="f13 ${m.id===STATE.user.id?'bold':''}">${m.display_name||m.username} ${m.id===STATE.user.id?'<span class="nb f11">YOU</span>':''}</div>
          <div class="f11 mut">Fund: <span style="color:#00ff88">$${contrib.toFixed(0)}</span></div>
        </div>
      `;
      card.append(row);
    });
    col.append(card);
  } else {
    col.append(html('<div class="card text-center mut f12" style="padding:40px">Join a group to see rankings</div>'));
  }

  const statsCard = el('div', {className:'card'});
  statsCard.innerHTML = '<div class="section-title mb16">YOUR STATS</div>';
  statsCard.append(buildPeriodStats());
  col.append(statsCard);
  container.append(col);
}

// ─── AI INSIGHTS ─────────────────────────────────────────────────────────────
function renderInsights(container) {
  const card = el('div', {className:'card'});
  const header = el('div', {className:'flex-between mb16'});
  header.innerHTML = '<div class="section-title">🤖 AI INSIGHTS</div>';

  const genBtn = el('button', {className:'btn btn-o btn-sm'}, 'GENERATE');
  const resultsDiv = el('div', {className:'flex-col', style:{gap:'10px'}});

  if (!STATE.transactions.length) {
    resultsDiv.append(html('<div class="text-center mut f12" style="padding:20px">Add transactions to unlock AI insights</div>'));
    genBtn.disabled = true;
  }

  genBtn.onclick = async () => {
    genBtn.disabled=true; genBtn.textContent='ANALYZING...';
    resultsDiv.innerHTML='<div class="flex-gap8 mut f13"><span class="spin" style="font-size:18px">◌</span> Analyzing your financial patterns...</div>';
    try {
      const summary = {
        total:   STATE.transactions.reduce((s,t)=>s+t.amount,0),
        count:   STATE.transactions.length,
        weekly:  STATE.transactions.filter(t=>t.date>=cutoffMap.week()).reduce((s,t)=>s+t.amount,0),
        monthly: STATE.transactions.filter(t=>t.date>=cutoffMap.month()).reduce((s,t)=>s+t.amount,0),
        byCategory: STATE.categories.map(c=>({cat:c,sum:STATE.transactions.filter(t=>t.category===c).reduce((s,t)=>s+t.amount,0)})).filter(x=>x.sum!==0),
        recent: STATE.transactions.slice(-10).map(t=>({amount:t.amount,category:t.category,date:t.date})),
      };
      const res  = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,messages:[{role:'user',content:`Financial AI. Analyze data, return EXACTLY 5 smart insights as JSON array. Each: {"icon":"<emoji>","title":"<short title>","detail":"<1-2 specific sentences>"}. JSON only, no markdown.\n\nData: ${JSON.stringify(summary)}`}]})});
      const data = await res.json();
      const text = (data.content?.[0]?.text||'[]').replace(/```json|```/g,'').trim();
      const insights = JSON.parse(text);
      resultsDiv.innerHTML='';
      insights.forEach((ins,i) => {
        const div = el('div', {style:{padding:'12px 14px',background:'rgba(0,212,255,.04)',border:'1px solid rgba(0,212,255,.1)',borderRadius:'10px'}});
        div.innerHTML=`<div class="flex-gap10 f13"><span style="font-size:20px">${ins.icon}</span><div><div class="bold nb mb4">${ins.title}</div><div class="f12 mut" style="line-height:1.5">${ins.detail}</div></div></div>`;
        resultsDiv.append(div);
      });
    } catch(e) { resultsDiv.innerHTML=`<div class="err">Could not generate insights: ${e.message}</div>`; }
    genBtn.disabled=false; genBtn.textContent='GENERATE';
  };

  header.append(genBtn);
  card.append(header, resultsDiv);
  container.append(card);
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function renderSettings(container) {
  const col = el('div', {className:'flex-col', style:{gap:'20px'}});

  // Categories
  const catCard = el('div', {className:'card'});
  catCard.innerHTML = '<div class="section-title mb16">TRANSACTION CATEGORIES</div>';
  const catChips = el('div', {className:'flex-gap8 mb16', style:{flexWrap:'wrap'}});
  const renderCats = () => {
    catChips.innerHTML='';
    STATE.categories.forEach(c => {
      const chip = el('div', {style:{display:'flex',alignItems:'center',gap:'6px',padding:'6px 12px',background:'rgba(0,212,255,.06)',border:'1px solid rgba(0,212,255,.15)',borderRadius:'20px'}});
      chip.innerHTML=`<span class="f12">${c}</span>`;
      if (STATE.categories.length>1) {
        const x = el('button', {style:{background:'none',border:'none',color:'var(--mut)',cursor:'pointer',fontSize:'12px'}, onclick:async()=>{ await api('DELETE',`/categories/${encodeURIComponent(c)}`); STATE.categories=STATE.categories.filter(x=>x!==c); renderCats(); }}, '✕');
        chip.append(x);
      }
      catChips.append(chip);
    });
  };
  renderCats();
  catCard.append(catChips);
  const catRow = el('div', {className:'form-row'});
  const catInp = el('input', {className:'inp', placeholder:'Add category (e.g. Stocks, Dropshipping...)'});
  const catBtn = el('button', {className:'btn btn-g btn-sm', onclick:async()=>{
    const v=catInp.value.trim(); if(!v||STATE.categories.includes(v)) return;
    await api('POST','/categories',{name:v}); STATE.categories.push(v); catInp.value=''; renderCats();
  }}, '+ ADD');
  catInp.addEventListener('keydown',e=>{ if(e.key==='Enter') catBtn.click(); });
  catRow.append(catInp, catBtn);
  catCard.append(catRow);
  col.append(catCard);

  // Wallet
  col.append(buildWalletCard(false));

  // Account
  const accCard = el('div', {className:'card'});
  accCard.innerHTML = '<div class="section-title mb16">ACCOUNT</div>';
  const accRow = el('div', {className:'flex-gap10 mb20'});
  accRow.innerHTML = `
    <div class="avatar-circle" style="width:56px;height:56px;font-size:22px;font-family:Orbitron,sans-serif">${STATE.user.avatar}</div>
    <div><div class="bold f13">${STATE.user.displayName}</div><div class="f12 mut">@${STATE.user.username}</div></div>
  `;
  accCard.append(accRow);
  const signOutBtn = el('button', {className:'btn btn-o btn-full', style:{color:'#ff3366',borderColor:'rgba(255,51,102,.3)'}, onclick:logout}, 'SIGN OUT');
  accCard.append(signOutBtn);
  col.append(accCard);

  container.append(col);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
async function boot() {
  const appDiv = $('app');

  // Check for existing token
  if (STATE.token) {
    try {
      STATE.user = await api('GET', '/auth/me');
      await loadAll();
      initSocket();
      renderApp();
    } catch {
      localStorage.removeItem('nf_token');
      STATE.token = null;
      appDiv.append(renderAuth());
    }
  } else {
    appDiv.append(renderAuth());
  }
}

// Start!
boot();
