const API_BASE = '/.netlify/functions';

const WALLET_ENDPOINTS = {
  ethereum: 'wallets-eth',
  robinhood: 'wallets-robinhood',
  solana: 'wallets-solana'
};

const SECTION_ORDER = ['wallets', 'updates', 'watchlist', 'charts', 'chat'];

const app = {
  wallets: [],
  watchlist: [],
  chatHistory: [],
  walletSignals: [],
  newsItems: [],
  trends: [],
  trendHistory: [],
  livePrice: null,
  trendingTokens: [],
  walletPortfolios: {},
  alerts: [],
  recognition: null,
  isListening: false, // deprecated, kept only to avoid breaking any stray references
  synth: window.speechSynthesis,
  sectionsOpen: { wallets: false, updates: false, watchlist: false, charts: false, chat: false },
  lastScannedMint: null,
  lastScannedPair: null,

  speakGreeting() {
    const hour = new Date().getHours();
    let timeGreeting = 'Good evening';
    if (hour < 12) timeGreeting = 'Good morning';
    else if (hour < 18) timeGreeting = 'Good afternoon';
    // Browsers often block speech synthesis that isn't tied to a user
    // gesture, so this may not always play automatically - that's an
    // inherent browser restriction, not a bug. It'll still work fine the
    // moment the user taps anything on the page.
    this.speak(`${timeGreeting}, Edwin. What do you want us to do?`);
  },

  async init() {
    this.speakGreeting();
    this.loadWallets();
    this.renderWallets();
    this.loadWatchlist();
    this.renderWatchlist();
    this.loadChatHistory();
    this.renderChatHistory();
    this.loadTrendHistory();
    this.loadAlerts();
    this.renderAlerts();

    document.getElementById('chatInput').addEventListener('keypress', e => {
      if (e.key === 'Enter') this.sendChat();
    });
    document.getElementById('walletInput')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.addWallet();
    });
    document.getElementById('tokenInput')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.checkToken();
    });

    this.setupSpeechRecognition();

    // Desktop shows the sidebar dashboard, starting on the Home page.
    // Mobile always shows the normal stacked card list directly.
    this.isDesktop = window.innerWidth >= 900;
    if (this.isDesktop) {
      document.getElementById('sidebarNav').style.display = 'flex';
      document.getElementById('topBadge').style.display = 'inline-flex';
      this.showPage('home');
    }

    await this.refresh();
    setInterval(() => this.refresh(), 5 * 60 * 1000);

    // Keep displayed "time ago" labels accurate without needing a full
    // refetch - re-render from cached data every 30s.
    setInterval(() => {
      this.renderWalletSignals();
      this.renderNews();
      this.renderWatchlist();
    }, 30 * 1000);
  },

  // ---------- Sidebar dashboard page switching (desktop only) ----------
  ALL_PAGE_IDS: ['page-home', 'page-tradebot', 'page-settings'],
  ALL_GROUP_IDS: { wallets: 'walletsGroup', updates: 'updatesGroup', watchlist: 'watchlistGroup', charts: 'chartsGroup', chat: 'chatGroup' },

  showPage(name) {
    if (!this.isDesktop) { this.openSection(name); return; }

    // Hide every standalone page and every card-group first.
    this.ALL_PAGE_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    Object.values(this.ALL_GROUP_IDS).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Update nav active state
    document.querySelectorAll('.sidebar-nav-desktop .nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === name);
    });

    document.getElementById('hubBackBar').style.display = name === 'home' ? 'none' : 'flex';

    if (name === 'home' || name === 'tradebot' || name === 'settings') {
      document.getElementById(`page-${name}`).style.display = 'block';
      if (name === 'home') this.renderHomeDashboard();
    } else if (this.ALL_GROUP_IDS[name]) {
      document.getElementById(this.ALL_GROUP_IDS[name]).style.display = 'block';
      this.openSection(name);
      document.getElementById(`${name}CardHeader`).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  closeHubDetail() {
    if (!this.isDesktop) return;
    this.showPage('home');
  },

  // Unified entry point other code should use instead of calling
  // openSection/showPage directly, so behavior stays consistent whether
  // the sidebar dashboard is active or not.
  goToSection(name) {
    if (this.isDesktop) this.showPage(name);
    else this.openSection(name);
  },

  renderHomeDashboard() {
    const walletsCount = this.wallets.length;
    const scannedCount = this.watchlist.length;
    const alertsCount = this.alerts.length;

    document.getElementById('homeWalletsCount').textContent = walletsCount;
    document.getElementById('homeScannedCount').textContent = scannedCount;
    document.getElementById('homeAlertsCount').textContent = alertsCount;
    document.getElementById('homeUsageWallets').textContent = walletsCount;
    document.getElementById('homeUsageScans').textContent = scannedCount;

    if (scannedCount > 0) {
      const levelScore = { low: 1, medium: 2, high: 3 };
      const avg = this.watchlist.reduce((sum, w) => sum + (levelScore[w.level] || 1), 0) / scannedCount;
      const avgLabel = avg >= 2.5 ? 'High' : avg >= 1.5 ? 'Medium' : 'Low';
      document.getElementById('homeAvgRisk').textContent = avgLabel;
    } else {
      document.getElementById('homeAvgRisk').textContent = '\u2014';
    }

    const recentEl = document.getElementById('homeRecentScans');
    if (this.watchlist.length === 0) {
      recentEl.innerHTML = '<div class="empty-note">No tokens scanned yet.</div>';
    } else {
      recentEl.innerHTML = this.watchlist.slice(0, 4).map(w => {
        const short = w.mint.slice(0, 6) + '...' + w.mint.slice(-4);
        return `<div class="watchlist-card" onclick="app.openWatchlistChart('${w.pairAddress || ''}')" style="cursor:pointer;">
          <div class="wl-top"><span class="wl-mint">${short}</span><span class="risk-badge ${w.level}">${w.level}</span></div>
          <div class="wl-time">${this.timeAgo(w.checkedAt)}</div>
        </div>`;
      }).join('');
    }

    const homeAlertsEl = document.getElementById('homeAlertsList');
    if (homeAlertsEl) {
      homeAlertsEl.innerHTML = this.alerts.length === 0
        ? '<div class="empty-note">No active alerts.</div>'
        : this.alerts.slice(0, 5).map(a => `<div class="alert-item"><span>${a.text}</span></div>`).join('');
    }

    const homeTrendingEl = document.getElementById('homeTrendingList');
    if (homeTrendingEl) {
      homeTrendingEl.innerHTML = this.trendingTokens.length === 0
        ? '<div class="empty-note">No trending data yet.</div>'
        : this.trendingTokens.slice(0, 5).map(t => {
            const changeClass = (t.priceChange24h || 0) >= 0 ? 'ok' : 'high';
            const changeSign = (t.priceChange24h || 0) >= 0 ? '+' : '';
            return `<div class="trending-token-item" onclick="app.checkToken('${t.address}'); app.goToSection('watchlist');">
              <div class="tt-left"><div class="tt-symbol">${t.symbol || '?'}</div><div class="tt-name">${t.name || ''}</div></div>
              <div class="tt-right"><div class="tt-change ${changeClass}">${changeSign}${(t.priceChange24h || 0).toFixed(1)}%</div></div>
            </div>`;
          }).join('');
    }
  },

  toggleSection(name) {
    const isOpen = this.sectionsOpen[name];
    this.sectionsOpen[name] = !isOpen;
    document.getElementById(`${name}Body`).style.display = isOpen ? 'none' : 'block';
    document.getElementById(`${name}Chevron`).classList.toggle('open', !isOpen);
  },

  openSection(name) {
    if (!this.sectionsOpen[name]) this.toggleSection(name);
  },

  cycleNextSection() {
    const currentlyOpen = SECTION_ORDER.find(s => this.sectionsOpen[s]);
    const currentIdx = currentlyOpen ? SECTION_ORDER.indexOf(currentlyOpen) : -1;
    const nextIdx = (currentIdx + 1) % SECTION_ORDER.length;
    if (currentlyOpen) this.toggleSection(currentlyOpen);
    if (this.isDesktop) {
      this.showPage(SECTION_ORDER[nextIdx]);
    } else {
      this.toggleSection(SECTION_ORDER[nextIdx]);
      document.getElementById(`${SECTION_ORDER[nextIdx]}CardHeader`).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  clearChatOnly() {
    this.chatHistory = [];
    localStorage.removeItem('j7t_chat_history');
    document.getElementById('chatLog').innerHTML = '';
    this.updateChatControlsVisibility();
  },

  clearLogs() {
    this.clearChatOnly();
    this.walletSignals = [];
    this.renderWalletSignals();
    this.alerts = [];
    this.saveAlerts();
    this.renderAlerts();
  },

  updateChatControlsVisibility() {
    const controls = document.getElementById('chatLogControls');
    if (controls) controls.style.display = this.chatHistory.length > 0 ? 'flex' : 'none';
  },

  // ---------- Wallets ----------
  loadWallets() {
    try {
      const stored = localStorage.getItem('j7t_wallets');
      this.wallets = stored ? JSON.parse(stored) : [];
    } catch { this.wallets = []; }
  },
  saveWallets() { localStorage.setItem('j7t_wallets', JSON.stringify(this.wallets)); },

  addWallet() {
    const input = document.getElementById('walletInput');
    const chain = document.getElementById('chainSelect').value;
    const address = input.value.trim();
    if (!address) return;
    if (this.wallets.some(w => w.address === address && w.chain === chain)) { input.value = ''; return; }
    this.wallets.push({ address, chain });
    this.saveWallets();
    input.value = '';
    this.renderWallets();
    this.refresh();
  },

  removeWallet(address, chain) {
    this.wallets = this.wallets.filter(w => !(w.address === address && w.chain === chain));
    this.saveWallets();
    this.renderWallets();
    if (this.isDesktop) this.renderHomeDashboard();
  },

  renderWallets() {
    const list = document.getElementById('walletList');
    document.getElementById('walletsSummary').textContent = `${this.wallets.length} watched`;
    if (this.wallets.length === 0) {
      list.innerHTML = '<div class="empty-note">No wallets added yet.</div>';
      return;
    }
    list.innerHTML = this.wallets.map(w => {
      const short = w.address.length > 10 ? w.address.slice(0, 6) + '...' + w.address.slice(-4) : w.address;
      const portfolio = this.walletPortfolios[w.address];
      const portfolioLine = portfolio
        ? `<div class="wallet-portfolio-value">$${portfolio.totalValueUsd.toLocaleString(undefined, {maximumFractionDigits: 2})} &middot; ${portfolio.solBalance.toFixed(3)} SOL</div>`
        : (w.chain === 'solana' ? '<div class="wallet-portfolio-value muted">Loading value...</div>' : '');
      return `
        <div class="wallet-card">
          <div class="addr"><span>${short}</span>
            <button class="remove-btn" onclick="app.removeWallet('${w.address}','${w.chain}')">&times;</button>
          </div>
          <div class="chain-tag">${w.chain}</div>
          ${portfolioLine}
        </div>`;
    }).join('');
  },

  async fetchWalletPortfolios() {
    const solanaWallets = this.wallets.filter(w => w.chain === 'solana');
    await Promise.all(solanaWallets.map(async w => {
      const data = await this.fetchJson('wallet-portfolio', { address: w.address });
      if (data && !data.error) {
        this.walletPortfolios[w.address] = data;
      }
    }));
    this.renderWallets();
  },

  // ---------- Watchlist / token risk ----------
  loadWatchlist() {
    try {
      const stored = localStorage.getItem('j7t_watchlist');
      this.watchlist = stored ? JSON.parse(stored) : [];
    } catch { this.watchlist = []; }
  },
  saveWatchlist() { localStorage.setItem('j7t_watchlist', JSON.stringify(this.watchlist)); },

  async checkToken(prefilledMint) {
    const input = document.getElementById('tokenInput');
    const mint = prefilledMint || input.value.trim();
    if (!mint) return;
    const resultEl = document.getElementById('tokenCheckResult');
    resultEl.innerHTML = '<div class="empty-note">Scanning...</div>';

    const data = await this.fetchJson('token-risk', { mint });
    if (data.error) {
      resultEl.innerHTML = `<div class="empty-note">Scan failed: ${data.error}</div>`;
      return;
    }
    this.renderTokenCheck(data, resultEl);

    this.watchlist.unshift({
      mint: data.mint, level: data.level, score: data.score,
      concentrationPct: data.concentrationPct, checkedAt: data.checkedAt,
      flags: data.flags, marketCap: data.market?.marketCap || null,
      pairAddress: data.market?.pairAddress || null
    });
    this.watchlist = this.watchlist.slice(0, 50);
    this.saveWatchlist();
    this.renderWatchlist();
    input.value = '';

    this.lastScannedMint = data.mint;
    const shortMint = `${data.mint.slice(0, 6)}...${data.mint.slice(-4)}`;
    this.setScannedChartTarget(data.market?.pairAddress, shortMint);
    if (this.isDesktop) this.renderHomeDashboard();
  },

  renderTokenCheck(data, el) {
    const flagsHtml = data.flags.map(f => `
      <div class="flag-item"><span class="flag-dot ${f.severity}"></span><span class="flag-text">${f.label}</span></div>
    `).join('');
    const mcapLine = data.market?.marketCap
      ? `<div class="market-line">Market cap: $${Number(data.market.marketCap).toLocaleString()}</div>` : '';
    const marketHtml = data.market ? `
      ${mcapLine}
      <div class="market-line">$${data.market.liquidityUsd.toLocaleString()} liquidity · $${data.market.volume24h.toLocaleString()} 24h vol · via ${data.market.dexId}</div>
    ` : '';
    el.innerHTML = `
      <div class="token-check-card">
        <div class="mint">${data.mint}</div>
        <span class="risk-badge ${data.level}">${data.level} risk</span>
        ${marketHtml}
        <div class="flag-list">${flagsHtml}</div>
      </div>`;
  },

  renderWatchlist() {
    const el = document.getElementById('watchlist');
    document.getElementById('watchlistSummary').textContent = `${this.watchlist.length} scanned`;
    if (this.watchlist.length === 0) {
      el.innerHTML = '<div class="empty-note">No tokens scanned yet.</div>';
      return;
    }
    el.innerHTML = this.watchlist.map((w, i) => {
      const short = w.mint.slice(0, 6) + '...' + w.mint.slice(-4);
      const mcap = w.marketCap ? `$${Number(w.marketCap).toLocaleString()} mcap` : '';
      return `
        <div class="watchlist-card">
          <div class="wl-top">
            <span class="wl-mint" onclick="app.openWatchlistChart('${w.pairAddress || ''}')" style="cursor:pointer;">${short}</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="risk-badge ${w.level}">${w.level}</span>
              <button class="remove-btn" onclick="event.stopPropagation(); app.removeFromWatchlist(${i});" title="Remove">&times;</button>
            </div>
          </div>
          <div class="wl-time" onclick="app.openWatchlistChart('${w.pairAddress || ''}')" style="cursor:pointer;">${mcap ? mcap + ' · ' : ''}${this.timeAgo(w.checkedAt)}</div>
        </div>`;
    }).join('');
  },

  removeFromWatchlist(index) {
    this.watchlist.splice(index, 1);
    this.saveWatchlist();
    this.renderWatchlist();
    if (this.isDesktop) this.renderHomeDashboard();
  },

  timeAgo(iso) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },

  // ---------- Charts: opened externally on DexScreener, never embedded ----------
  // Embedding DexScreener's own site in an iframe proved unreliable (it's
  // not built for third-party embedding and can hang indefinitely instead
  // of failing clearly). Opening the real page in a new tab is slower by
  // one click but always works.
  setScannedChartTarget(pairAddress, label) {
    this.lastScannedPair = pairAddress || null;
    const btn = document.getElementById('lastScanChartBtn');
    if (btn) {
      btn.style.display = pairAddress ? 'block' : 'none';
      btn.textContent = pairAddress ? `Open ${label || 'scanned token'}'s chart \u2197` : '';
    }
  },

  openWatchlistChart(pairAddress) {
    if (!pairAddress) {
      alert('No trading pair was found for this token when it was scanned.');
      return;
    }
    window.open(`https://dexscreener.com/solana/${pairAddress}`, '_blank', 'noopener');
  },

  openChartExternal(useLastScanned) {
    const pairAddress = useLastScanned ? this.lastScannedPair : '58oqchx4ywmvkdwllzzbi4chocc2fqcuwbkwmihlyqo2';
    if (!pairAddress) {
      alert('No trading pair available for this token yet.');
      return;
    }
    window.open(`https://dexscreener.com/solana/${pairAddress}`, '_blank', 'noopener');
  },

  // ---------- Alerts ----------
  loadAlerts() {
    try {
      const stored = localStorage.getItem('j7t_alerts');
      this.alerts = stored ? JSON.parse(stored) : [];
    } catch { this.alerts = []; }
  },
  saveAlerts() { localStorage.setItem('j7t_alerts', JSON.stringify(this.alerts.slice(0, 20))); },

  addAlert(text) {
    this.alerts.unshift({ id: Date.now() + Math.random(), text, at: new Date().toISOString() });
    this.saveAlerts();
    this.renderAlerts();
  },

  dismissAlert(id) {
    this.alerts = this.alerts.filter(a => a.id !== id);
    this.saveAlerts();
    this.renderAlerts();
  },

  renderAlerts() {
    const banner = document.getElementById('alertsBanner');
    const list = document.getElementById('alertsList');
    if (this.alerts.length === 0) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = 'block';
    list.innerHTML = this.alerts.slice(0, 8).map(a => `
      <div class="alert-item">
        <span>${a.text}</span>
        <button class="alert-dismiss" onclick="app.dismissAlert(${a.id})">&times;</button>
      </div>`).join('');
  },

  // Re-checks the few most recently scanned watchlist tokens each refresh
  // cycle and raises an in-app alert if their risk level has changed since
  // last time. Capped to a small number to keep API usage reasonable.
  async checkWatchlistForRiskChanges() {
    const toRecheck = this.watchlist.slice(0, 10);
    for (const entry of toRecheck) {
      const data = await this.fetchJson('token-risk', { mint: entry.mint });
      if (data.error || !data.level) continue;
      if (data.level !== entry.level) {
        const short = entry.mint.slice(0, 6) + '...' + entry.mint.slice(-4);
        this.addAlert(`${short} risk changed: ${entry.level} → ${data.level}`);
        entry.level = data.level;
        entry.score = data.score;
        entry.checkedAt = data.checkedAt;
      }
    }
    this.saveWatchlist();
    this.renderWatchlist();
  },

  // ---------- Trend history (for time-based synthesis in chat) ----------
  loadTrendHistory() {
    try {
      const stored = localStorage.getItem('j7t_trend_history');
      this.trendHistory = stored ? JSON.parse(stored) : [];
    } catch { this.trendHistory = []; }
  },

  saveTrendSnapshot(trends) {
    if (!trends || trends.length === 0) return;
    this.trendHistory.push({ at: new Date().toISOString(), trends: trends.slice(0, 8) });
    // Keep a bounded but useful window - roughly the last couple of days
    // at a 5-minute refresh cadence would be too much, so sample sparsely.
    this.trendHistory = this.trendHistory.slice(-100);
    localStorage.setItem('j7t_trend_history', JSON.stringify(this.trendHistory));
  },

  // ---------- Refresh: wallets, news, trends ----------
  async refresh() {
    this.setStatus(true, 'SYNCING');
    try {
      const [walletSignals, newsData, priceData, trendingData] = await Promise.all([
        this.fetchWalletSignals(),
        this.fetchJson('news'),
        this.fetchJson('price'),
        this.fetchJson('trending-tokens')
      ]);

      this.walletSignals = walletSignals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      this.renderWalletSignals();

      this.newsItems = newsData.news || [];
      this.trends = newsData.trending || [];
      this.renderNews();
      this.renderTrends();
      this.saveTrendSnapshot(this.trends);

      if (priceData && !priceData.error) {
        this.livePrice = priceData;
      }

      if (trendingData && !trendingData.error) {
        this.trendingTokens = trendingData.tokens || [];
        this.renderTrendingTokens();
      }

      document.getElementById('updatesSummary').textContent = `${this.newsItems.length} new`;
      this.setStatus(true, 'LIVE');

      // Don't block the main refresh on alert re-checks
      this.checkWatchlistForRiskChanges();
      this.fetchWalletPortfolios();
      if (this.isDesktop) this.renderHomeDashboard();
    } catch (err) {
      console.error('Refresh failed:', err);
      this.setStatus(false, 'ERROR');
    }
  },

  async fetchWalletSignals() {
    const byChain = {};
    this.wallets.forEach(w => {
      if (!byChain[w.chain]) byChain[w.chain] = [];
      byChain[w.chain].push(w.address);
    });
    const results = await Promise.all(
      Object.entries(byChain).map(async ([chain, addrs]) => {
        const fn = WALLET_ENDPOINTS[chain];
        if (!fn) return [];
        const data = await this.fetchJson(fn, { addrs: addrs.join(',') });
        return data.signals || [];
      })
    );
    return results.flat();
  },

  async fetchJson(fnName, params = {}) {
    const bustedParams = { ...params, _t: Date.now() };
    const query = new URLSearchParams(bustedParams).toString();
    const url = `${API_BASE}/${fnName}${query ? '?' + query : ''}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      return await res.json();
    } catch (err) {
      console.error(`Fetch failed for ${fnName}:`, err.message);
      return {};
    }
  },

  renderWalletSignals() {
    const log = document.getElementById('walletSignalLog');
    if (this.walletSignals.length === 0) {
      log.innerHTML = '<div class="empty-note">No wallet activity yet.</div>';
      return;
    }
    log.innerHTML = this.walletSignals.slice(0, 25).map(s => {
      const tappable = !!s.boughtMint;
      const actions = tappable ? `
        <div class="signal-actions">
          <button class="signal-action-btn" onclick="event.stopPropagation(); app.checkToken('${s.boughtMint}'); app.goToSection('watchlist');">Analyze risk</button>
          <button class="signal-action-btn" onclick="event.stopPropagation(); window.open('https://dexscreener.com/solana/${s.boughtMint}', '_blank', 'noopener');">View chart &#8599;</button>
        </div>` : '';
      return `
      <div class="signal-row">
        <span class="signal-tag wallet">wallet</span>
        <div style="flex:1;">
          <div class="signal-title">${s.title}</div>
          <div class="signal-sub">${s.subtitle || ''}</div>
          ${actions}
        </div>
        <div class="signal-time">${this.timeAgo(s.timestamp)}</div>
      </div>`;
    }).join('');
  },

  renderNews() {
    const list = document.getElementById('newsList');
    if (this.newsItems.length === 0) {
      list.innerHTML = '<div class="empty-note">No headlines yet.</div>';
      return;
    }
    list.innerHTML = this.newsItems.map(n => `
      <div class="news-item">
        <span class="cat ${n.category}">${n.category}</span>
        <div class="title">${n.title}</div>
        <div class="meta">${n.subtitle} · ${this.timeAgo(n.timestamp)}</div>
      </div>`).join('');
  },

  renderTrends() {
    const list = document.getElementById('trendList');
    if (this.trends.length === 0) {
      list.innerHTML = '<div class="empty-note">No trend data yet.</div>';
      return;
    }
    const max = Math.max(...this.trends.map(t => t.count));
    list.innerHTML = this.trends.map(t => `
      <div class="trend-item">
        <div class="trend-name">${t.name}</div>
        <div class="trend-bar-wrap"><div class="trend-bar" style="width:${(t.count / max) * 100}%"></div></div>
        <div class="trend-count">${t.count} mentions</div>
      </div>`).join('');
  },

  renderTrendingTokens() {
    const list = document.getElementById('trendingTokensList');
    if (!list) return;
    if (this.trendingTokens.length === 0) {
      list.innerHTML = '<div class="empty-note">No trending token data yet.</div>';
      return;
    }
    list.innerHTML = this.trendingTokens.map(t => {
      const changeClass = (t.priceChange24h || 0) >= 0 ? 'ok' : 'high';
      const changeSign = (t.priceChange24h || 0) >= 0 ? '+' : '';
      return `
        <div class="trending-token-item" onclick="app.checkToken('${t.address}'); app.goToSection('watchlist');">
          <div class="tt-left">
            <div class="tt-symbol">${t.symbol || '?'}</div>
            <div class="tt-name">${t.name || ''}</div>
          </div>
          <div class="tt-right">
            <div class="tt-change ${changeClass}">${changeSign}${(t.priceChange24h || 0).toFixed(1)}%</div>
            <div class="tt-vol">$${Number(t.volume24h || 0).toLocaleString()} vol</div>
          </div>
        </div>`;
    }).join('');
  },

  setStatus(online, label) {
    document.getElementById('statusDot').classList.toggle('offline', !online);
    document.getElementById('statusText').textContent = label;
    const dotDesktop = document.getElementById('statusDotDesktop');
    const textDesktop = document.getElementById('statusTextDesktop');
    if (dotDesktop) dotDesktop.classList.toggle('offline', !online);
    if (textDesktop) textDesktop.textContent = label;
  },

  // ---------- Chat persistence ----------
  loadChatHistory() {
    try {
      const stored = localStorage.getItem('j7t_chat_history');
      this.chatHistory = stored ? JSON.parse(stored) : [];
    } catch { this.chatHistory = []; }
  },

  saveChatHistory() {
    const trimmed = this.chatHistory.slice(-60);
    localStorage.setItem('j7t_chat_history', JSON.stringify(trimmed));
    this.chatHistory = trimmed;
  },

  renderChatHistory() {
    const log = document.getElementById('chatLog');
    log.innerHTML = '';
    this.chatHistory.forEach(msg => this.appendChatBubble(msg.role, msg.content));
    this.updateChatControlsVisibility();
  },

  // ---------- Chat (with full history/context + trend history) ----------
  async sendChat(spokenText) {
    const input = document.getElementById('chatInput');
    const message = spokenText || input.value.trim();
    if (!message) return;
    input.value = '';

    this.appendChatBubble('user', message);
    const thinkingEl = this.appendChatBubble('assistant', 'Thinking...', true);

    // Condense trend history into a compact time series so the model can
    // reason about how things have shifted, not just the current snapshot.
    const trendSeries = this.trendHistory.slice(-20).map(snap => ({
      at: snap.at,
      top: snap.trends.slice(0, 4).map(t => `${t.name}(${t.count})`).join(', ')
    }));

    const context = {
      livePrice: this.livePrice,
      currentlyTrendingSolanaTokens: this.trendingTokens,
      watchedWallets: this.wallets,
      watchlist: this.watchlist,
      walletSignals: this.walletSignals.slice(0, 50),
      newsItems: this.newsItems,
      trendingTopics: this.trends,
      trendHistoryOverTime: trendSeries
    };

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context, history: this.chatHistory })
      });
      const data = await res.json();
      thinkingEl.remove();

      if (data.error) {
        this.appendChatBubble('assistant', `Error: ${data.error}`);
        return;
      }
      const cleanReply = this.stripMarkdown(data.reply);
      this.appendChatBubble('assistant', cleanReply);
      this.speak(cleanReply);
      this.chatHistory.push({ role: 'user', content: message });
      this.chatHistory.push({ role: 'assistant', content: cleanReply });
      this.saveChatHistory();
      this.updateChatControlsVisibility();
    } catch (err) {
      thinkingEl.remove();
      this.appendChatBubble('assistant', `Error: ${err.message}`);
    }
  },

  // Safety net: strips markdown symbols even if the model doesn't fully
  // follow the plain-text instruction, so voice output never reads out
  // literal asterisks, dashes, colons-as-headers, etc.
  stripMarkdown(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^[-•]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/`{1,3}/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, '. ')
      .trim();
  },

  appendChatBubble(role, text, isThinking = false) {
    const log = document.getElementById('chatLog');
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}${isThinking ? ' thinking' : ''}`;
    bubble.textContent = text;
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  },

  // ---------- Voice input / output ----------
  // ---------- Voice: single shared recognition instance ----------
  // Previously this used two separate SpeechRecognition objects (one for
  // the wake word, one for manual voice input). Browsers generally only
  // allow one active recognition session at a time, so whichever one
  // grabbed the mic first silently blocked the other - this was the real
  // cause of "both mic input and wake word broken." Now there's a single
  // instance with a mode flag, so they properly hand off to each other.
  voiceMode: 'idle', // 'idle' | 'wake' | 'command'
  wakeWordWanted: false,

  setupSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('SpeechRecognition not supported in this browser.');
      return;
    }
    this.recognition = new SR();
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = last[0].transcript.toLowerCase();

      if (this.voiceMode === 'wake') {
        this.handleWakePhrase(transcript);
      } else if (this.voiceMode === 'command' && last.isFinal) {
        document.getElementById('chatInput').value = transcript;
        this.sendChat(transcript);
      }
    };

    this.recognition.onend = () => {
      const wasCommand = this.voiceMode === 'command';
      this.voiceMode = 'idle';
      document.getElementById('voiceBtn').classList.remove('listening');
      document.getElementById('voiceLabel').textContent = 'voice';

      // Hand back to wake-word listening if it's still wanted and we
      // just finished a one-off command, or if the session simply ended
      // on silence while wake mode was active.
      if (this.wakeWordWanted) {
        setTimeout(() => this.startWakeListening(), 350);
      }
    };

    this.recognition.onerror = (e) => {
      this.voiceMode = 'idle';
      document.getElementById('voiceBtn').classList.remove('listening');
      document.getElementById('voiceLabel').textContent = 'voice';

      if (e.error === 'no-speech') return; // expected/frequent, not a real error
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        alert('Microphone permission was denied. Check Chrome\'s site settings (tap the lock icon in the address bar) and allow microphone access for this site.');
      } else if (e.error === 'audio-capture') {
        alert('No microphone was found on this device.');
      } else {
        console.error('Speech recognition error:', e.error);
      }
    };
  },

  startWakeListening() {
    if (!this.recognition || this.voiceMode !== 'idle') return;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.voiceMode = 'wake';
    try { this.recognition.start(); } catch (e) { /* already running */ }
  },

  toggleVoiceInput() {
    if (!this.recognition) {
      alert('Voice input is not supported in this browser. Try Chrome.');
      return;
    }
    // Barge-in: if the AI is mid-reply, tapping the mic should interrupt
    // it immediately rather than talking over the new question.
    if (this.synth && this.synth.speaking) {
      this.synth.cancel();
    }
    if (this.voiceMode === 'command') {
      this.recognition.stop();
      return;
    }
    // Stop wake listening first (if active) so the command listener can
    // take the mic - onend's handoff logic will resume wake mode after.
    if (this.voiceMode === 'wake') {
      this.recognition.stop();
    }
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.voiceMode = 'command';
    document.getElementById('voiceBtn').classList.add('listening');
    document.getElementById('voiceLabel').textContent = 'listening...';
    try { this.recognition.start(); } catch (e) {
      // If it was mid-stop from wake mode, retry shortly after.
      setTimeout(() => { try { this.recognition.start(); } catch (e2) { /* ignore */ } }, 300);
    }
  },

  speak(text) {
    if (!this.synth) return;
    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onerror = (e) => console.error('Speech synthesis error:', e.error);
    this.synth.speak(utterance);
  },

  // ---------- Wake word + voice quick-commands ----------
  handleWakePhrase(transcript) {
    if (transcript.includes('j7 portfolio') || transcript.includes('j seven portfolio')) {
      this.goToSection('wallets');
      document.getElementById('walletsCardHeader').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    if (transcript.includes('j7 next card') || transcript.includes('j seven next card')) {
      this.cycleNextSection();
      return true;
    }
    if (transcript.includes('j7 clear logs') || transcript.includes('j seven clear logs')) {
      this.clearLogs();
      return true;
    }
    if (transcript.includes('j7 activate') || transcript.includes('j seven activate')) {
      this.recognition.stop();
      setTimeout(() => this.toggleVoiceInput(), 200);
      return true;
    }
    return false;
  },

  toggleWakeWord(enabled) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mobileBox = document.getElementById('wakeWordToggle');
    const desktopBox = document.getElementById('wakeWordToggleDesktop');
    if (!SR) {
      alert('Wake word requires Chrome (SpeechRecognition not supported here).');
      if (mobileBox) mobileBox.checked = false;
      if (desktopBox) desktopBox.checked = false;
      return;
    }
    // Keep both checkboxes (mobile chat card + desktop settings page) in
    // sync, since both exist in the DOM at once now.
    if (mobileBox) mobileBox.checked = enabled;
    if (desktopBox) desktopBox.checked = enabled;

    this.wakeWordWanted = enabled;
    if (enabled) {
      this.startWakeListening();
    } else if (this.voiceMode === 'wake') {
      this.recognition.stop();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
