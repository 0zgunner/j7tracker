const API_BASE = '/.netlify/functions';

const WALLET_ENDPOINTS = {
  ethereum: 'wallets-eth',
  robinhood: 'wallets-robinhood',
  solana: 'wallets-solana'
};

const app = {
  wallets: [],
  watchlist: [],

  async init() {
    this.loadWallets();
    this.renderWallets();
    this.loadWatchlist();
    this.renderWatchlist();

    document.getElementById('walletInput').addEventListener('keypress', e => {
      if (e.key === 'Enter') this.addWallet();
    });
    document.getElementById('tokenInput').addEventListener('keypress', e => {
      if (e.key === 'Enter') this.checkToken();
    });

    await this.refresh();
    setInterval(() => this.refresh(), 5 * 60 * 1000);
  },

  loadWatchlist() {
    try {
      const stored = localStorage.getItem('j7t_watchlist');
      this.watchlist = stored ? JSON.parse(stored) : [];
    } catch {
      this.watchlist = [];
    }
  },

  saveWatchlist() {
    localStorage.setItem('j7t_watchlist', JSON.stringify(this.watchlist));
  },

  async checkToken() {
    const input = document.getElementById('tokenInput');
    const mint = input.value.trim();
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
      mint: data.mint,
      level: data.level,
      score: data.score,
      concentrationPct: data.concentrationPct,
      checkedAt: data.checkedAt
    });
    this.watchlist = this.watchlist.slice(0, 20);
    this.saveWatchlist();
    this.renderWatchlist();

    this.pendingRiskSignal = {
      type: 'risk',
      title: `Scanned ${mint.slice(0, 6)}...${mint.slice(-4)} — ${data.level.toUpperCase()} risk`,
      subtitle: data.flags.filter(f => f.severity !== 'ok').map(f => f.label).join(' · ') || 'No major red flags found',
      timestamp: data.checkedAt,
      ago: 'just now',
      riskLevel: data.level
    };
    input.value = '';
  },

  renderTokenCheck(data, el) {
    const flagsHtml = data.flags.map(f => `
      <div class="flag-item">
        <span class="flag-dot ${f.severity}"></span>
        <span class="flag-text">${f.label}</span>
      </div>
    `).join('');
    const marketHtml = data.market ? `
      <div class="market-line">$${data.market.liquidityUsd.toLocaleString()} liquidity · $${data.market.volume24h.toLocaleString()} 24h vol · via ${data.market.dexId}</div>
    ` : '';
    el.innerHTML = `
      <div class="token-check-card">
        <div class="mint">${data.mint}</div>
        <span class="risk-badge ${data.level}">${data.level} risk</span>
        ${marketHtml}
        <div class="flag-list">${flagsHtml}</div>
      </div>
    `;
  },

  renderWatchlist() {
    const el = document.getElementById('watchlist');
    if (this.watchlist.length === 0) {
      el.innerHTML = '<div class="empty-note">No tokens scanned yet.</div>';
      return;
    }
    el.innerHTML = this.watchlist.map(w => {
      const short = w.mint.slice(0, 6) + '...' + w.mint.slice(-4);
      const ago = this.timeAgo(w.checkedAt);
      return `
        <div class="watchlist-card">
          <div class="wl-top">
            <span class="wl-mint">${short}</span>
            <span class="risk-badge ${w.level}">${w.level}</span>
          </div>
          <div class="wl-time">${ago}</div>
        </div>
      `;
    }).join('');
  },

  timeAgo(iso) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },

  loadWallets() {
    try {
      const stored = localStorage.getItem('j7t_wallets');
      this.wallets = stored ? JSON.parse(stored) : [];
    } catch {
      this.wallets = [];
    }
  },

  saveWallets() {
    localStorage.setItem('j7t_wallets', JSON.stringify(this.wallets));
  },

  addWallet() {
    const input = document.getElementById('walletInput');
    const chain = document.getElementById('chainSelect').value;
    const address = input.value.trim();
    if (!address) return;

    if (this.wallets.some(w => w.address === address && w.chain === chain)) {
      input.value = '';
      return;
    }
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
  },

  renderWallets() {
    const list = document.getElementById('walletList');
    if (this.wallets.length === 0) {
      list.innerHTML = '<div class="empty-note">No wallets added yet.</div>';
      return;
    }
    list.innerHTML = this.wallets.map(w => {
      const short = w.address.length > 10 ? w.address.slice(0, 6) + '...' + w.address.slice(-4) : w.address;
      return `
        <div class="wallet-card">
          <div class="addr">
            <span>${short}</span>
            <button class="remove-btn" onclick="app.removeWallet('${w.address}','${w.chain}')">&times;</button>
          </div>
          <div class="chain-tag">${w.chain}</div>
        </div>
      `;
    }).join('');
  },

  async refresh() {
    this.setStatus(true, 'SYNCING');
    try {
      const [walletSignals, redditData, newsData] = await Promise.all([
        this.fetchWalletSignals(),
        this.fetchJson('reddit'),
        this.fetchJson('news')
      ]);

      const allSignals = [
        ...walletSignals,
        ...(redditData.signals || []),
        ...(newsData.news || []),
        ...(this.pendingRiskSignal ? [this.pendingRiskSignal] : [])
      ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      this.renderSignals(allSignals);

      const trends = [...(redditData.trends || []), ...(newsData.trending || [])]
        .reduce((acc, t) => {
          const existing = acc.find(x => x.name.toLowerCase() === t.name.toLowerCase());
          if (existing) existing.count += t.count;
          else acc.push({ ...t });
          return acc;
        }, [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      this.renderTrends(trends);
      this.buildTicker(trends);
      this.setStatus(true, 'LIVE');
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
    const query = new URLSearchParams(params).toString();
    const url = `${API_BASE}/${fnName}${query ? '?' + query : ''}`;
    try {
      const res = await fetch(url);
      return await res.json();
    } catch (err) {
      console.error(`Fetch failed for ${fnName}:`, err.message);
      return {};
    }
  },

  renderSignals(signals) {
    const log = document.getElementById('signalLog');
    if (signals.length === 0) {
      log.innerHTML = '<div class="empty-note">No signals yet. Add a wallet or check back shortly.</div>';
      return;
    }
    log.innerHTML = signals.slice(0, 25).map(s => {
      const tagClass = s.type === 'risk' ? `risk-${s.riskLevel}` : s.type;
      return `
        <div class="signal-row">
          <span class="signal-tag ${tagClass}">${s.type === 'risk' ? 'scan' : s.type}</span>
          <div class="signal-body">
            <div class="signal-title">${s.title}</div>
            <div class="signal-sub">${s.subtitle || ''}</div>
          </div>
          <div class="signal-time">${s.ago || ''}</div>
        </div>
      `;
    }).join('');
  },

  renderTrends(trends) {
    const list = document.getElementById('trendList');
    if (trends.length === 0) {
      list.innerHTML = '<div class="empty-note">No trend data yet.</div>';
      return;
    }
    const max = Math.max(...trends.map(t => t.count));
    list.innerHTML = trends.map(t => `
      <div class="trend-item">
        <div class="trend-name">${t.name}</div>
        <div class="trend-bar-wrap"><div class="trend-bar" style="width:${(t.count / max) * 100}%"></div></div>
        <div class="trend-count">${t.count} mentions</div>
      </div>
    `).join('');
  },

  buildTicker(trends) {
    const ticker = document.getElementById('ticker');
    const items = trends.length
      ? trends.map(t => `<span class="ticker-item"><b>${t.name}</b> ${t.count} mentions</span>`)
      : [`<span class="ticker-item">J7TRACKER online, waiting on trend data</span>`];
    ticker.innerHTML = [...items, ...items].join('');
  },

  setStatus(online, label) {
    document.getElementById('statusDot').classList.toggle('offline', !online);
    document.getElementById('statusText').textContent = label;
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
