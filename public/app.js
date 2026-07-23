const API_BASE = '/.netlify/functions';

const WALLET_ENDPOINTS = {
  ethereum: 'wallets-eth',
  robinhood: 'wallets-robinhood',
  solana: 'wallets-solana'
};

const SECTION_ORDER = ['wallets', 'updates', 'watchlist', 'charts'];

const app = {
  wallets: [],
  watchlist: [],
  chatHistory: [],
  walletSignals: [],
  newsItems: [],
  trends: [],
  trendHistory: [],
  alerts: [],
  recognition: null,
  wakeRecognition: null,
  isListening: false,
  synth: window.speechSynthesis,
  sectionsOpen: { wallets: false, updates: false, watchlist: false, charts: false },
  lastScannedMint: null,

  async init() {
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

    // On desktop, the Charts panel is a persistent side panel rather than
    // a collapsed card, so open it by default there. Mobile keeps it
    // collapsed like the other cards to save space.
    if (window.innerWidth >= 900) {
      this.toggleSection('charts');
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

  toggleSection(name) {
    const isOpen = this.sectionsOpen[name];
    this.sectionsOpen[name] = !isOpen;
    document.getElementById(`${name}Body`).style.display = isOpen ? 'none' : 'block';
    document.getElementById(`${name}Chevron`).classList.toggle('open', !isOpen);
    if (name === 'charts' && !isOpen) this.refreshChartFrame();
  },

  openSection(name) {
    if (!this.sectionsOpen[name]) this.toggleSection(name);
  },

  cycleNextSection() {
    const currentlyOpen = SECTION_ORDER.find(s => this.sectionsOpen[s]);
    const currentIdx = currentlyOpen ? SECTION_ORDER.indexOf(currentlyOpen) : -1;
    const nextIdx = (currentIdx + 1) % SECTION_ORDER.length;
    if (currentlyOpen) this.toggleSection(currentlyOpen);
    this.toggleSection(SECTION_ORDER[nextIdx]);
    document.getElementById(`${SECTION_ORDER[nextIdx]}CardHeader`).scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  clearLogs() {
    this.chatHistory = [];
    localStorage.removeItem('j7t_chat_history');
    document.getElementById('chatLog').innerHTML = '';
    this.walletSignals = [];
    this.renderWalletSignals();
    this.alerts = [];
    this.saveAlerts();
    this.renderAlerts();
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
      return `
        <div class="wallet-card">
          <div class="addr"><span>${short}</span>
            <button class="remove-btn" onclick="app.removeWallet('${w.address}','${w.chain}')">&times;</button>
          </div>
          <div class="chain-tag">${w.chain}</div>
        </div>`;
    }).join('');
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
    this.updateChartTo(data.market?.pairAddress, true, shortMint);
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
    el.innerHTML = this.watchlist.map(w => {
      const short = w.mint.slice(0, 6) + '...' + w.mint.slice(-4);
      const mcap = w.marketCap ? `$${Number(w.marketCap).toLocaleString()} mcap` : '';
      return `
        <div class="watchlist-card" onclick="app.updateChartTo('${w.pairAddress || ''}', true, '${short}')" style="cursor:pointer;">
          <div class="wl-top"><span class="wl-mint">${short}</span><span class="risk-badge ${w.level}">${w.level}</span></div>
          <div class="wl-time">${mcap ? mcap + ' · ' : ''}${this.timeAgo(w.checkedAt)}</div>
        </div>`;
    }).join('');
  },

  timeAgo(iso) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },

  // ---------- Charts ----------
  updateChartTo(pairAddress, openSection, label) {
    const frame = document.getElementById('chartFrame');
    const labelEl = document.getElementById('chartLabel');
    const summary = document.getElementById('chartsSummary');
    if (!pairAddress) {
      labelEl.textContent = 'No trading pair found for this token yet';
      summary.textContent = 'No chart';
      if (openSection) this.openSection('charts');
      return;
    }
    frame.src = `https://dexscreener.com/solana/${pairAddress}?embed=1&theme=dark&trades=0&info=0`;
    labelEl.textContent = label || 'Token chart';
    summary.textContent = 'Token chart';
    if (openSection) this.openSection('charts');
  },

  resetChartToSolana() {
    const frame = document.getElementById('chartFrame');
    document.getElementById('chartLabel').textContent = 'General Solana market (SOL/USDC)';
    document.getElementById('chartsSummary').textContent = 'Solana';
    frame.src = 'https://dexscreener.com/solana/58oqchx4ywmvkdwllzzbi4chocc2fqcuwbkwmihlyqo2?embed=1&theme=dark&trades=0&info=0';
  },

  refreshChartFrame() {
    // No-op placeholder in case future logic needs to force-reload on open
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
    const toRecheck = this.watchlist.slice(0, 3);
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
      const [walletSignals, newsData] = await Promise.all([
        this.fetchWalletSignals(),
        this.fetchJson('news')
      ]);

      this.walletSignals = walletSignals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      this.renderWalletSignals();

      this.newsItems = newsData.news || [];
      this.trends = newsData.trending || [];
      this.renderNews();
      this.renderTrends();
      this.saveTrendSnapshot(this.trends);

      document.getElementById('updatesSummary').textContent = `${this.newsItems.length} new`;
      this.setStatus(true, 'LIVE');

      // Don't block the main refresh on alert re-checks
      this.checkWatchlistForRiskChanges();
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
      const clickAttr = tappable ? `onclick="app.checkToken('${s.boughtMint}'); app.openSection('watchlist');"` : '';
      const buyTag = tappable ? `<span class="signal-buy-tag">tap to scan this token &rarr;</span>` : '';
      return `
      <div class="signal-row ${tappable ? 'tappable' : ''}" ${clickAttr}>
        <span class="signal-tag wallet">wallet</span>
        <div style="flex:1;">
          <div class="signal-title">${s.title}</div>
          <div class="signal-sub">${s.subtitle || ''}</div>
          ${buyTag}
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

  setStatus(online, label) {
    document.getElementById('statusDot').classList.toggle('offline', !online);
    document.getElementById('statusText').textContent = label;
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
    return bubble;
  },

  // ---------- Voice input / output ----------
  setupSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('SpeechRecognition not supported in this browser.');
      return;
    }
    this.recognition = new SR();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      document.getElementById('chatInput').value = transcript;
      this.sendChat(transcript);
    };
    this.recognition.onend = () => {
      this.isListening = false;
      document.getElementById('voiceBtn').classList.remove('listening');
      document.getElementById('voiceLabel').textContent = 'voice';
    };
    this.recognition.onerror = (e) => {
      console.error('Speech recognition error:', e.error);
      this.isListening = false;
      document.getElementById('voiceBtn').classList.remove('listening');
      document.getElementById('voiceLabel').textContent = 'voice';
    };
  },

  toggleVoiceInput() {
    if (!this.recognition) {
      alert('Voice input is not supported in this browser. Try Chrome.');
      return;
    }
    if (this.isListening) {
      this.recognition.stop();
      return;
    }
    this.isListening = true;
    document.getElementById('voiceBtn').classList.add('listening');
    document.getElementById('voiceLabel').textContent = 'listening...';
    this.recognition.start();
  },

  speak(text) {
    if (!this.synth) return;
    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    this.synth.speak(utterance);
  },

  // ---------- Wake word + voice quick-commands ----------
  handleWakePhrase(transcript) {
    if (transcript.includes('j7 portfolio') || transcript.includes('j seven portfolio')) {
      this.wakeRecognition.stop();
      this.openSection('wallets');
      document.getElementById('walletsCardHeader').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    if (transcript.includes('j7 next card') || transcript.includes('j seven next card')) {
      this.wakeRecognition.stop();
      this.cycleNextSection();
      return true;
    }
    if (transcript.includes('j7 clear logs') || transcript.includes('j seven clear logs')) {
      this.wakeRecognition.stop();
      this.clearLogs();
      return true;
    }
    if (transcript.includes('j7 activate') || transcript.includes('j seven activate')) {
      this.wakeRecognition.stop();
      this.toggleVoiceInput();
      return true;
    }
    return false;
  },

  toggleWakeWord(enabled) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('Wake word requires Chrome (SpeechRecognition not supported here).');
      document.getElementById('wakeWordToggle').checked = false;
      return;
    }
    if (enabled) {
      this.wakeRecognition = new SR();
      this.wakeRecognition.continuous = true;
      this.wakeRecognition.interimResults = true;
      this.wakeRecognition.lang = 'en-US';

      this.wakeRecognition.onresult = (event) => {
        const last = event.results[event.results.length - 1];
        const transcript = last[0].transcript.toLowerCase();
        this.handleWakePhrase(transcript);
      };
      this.wakeRecognition.onend = () => {
        // Restart automatically if still enabled - Chrome frequently ends
        // the session on silence even in continuous mode. A short delay
        // avoids "recognition already started" errors on rapid restart.
        if (document.getElementById('wakeWordToggle').checked) {
          setTimeout(() => {
            if (document.getElementById('wakeWordToggle').checked) {
              try { this.wakeRecognition.start(); } catch (e) { /* already running */ }
            }
          }, 350);
        }
      };
      this.wakeRecognition.onerror = (e) => {
        // 'no-speech' is expected and frequent in continuous mode - not a
        // real error, just let onend handle the restart.
        if (e.error !== 'no-speech') {
          console.error('Wake word listener error:', e.error);
        }
      };

      try { this.wakeRecognition.start(); } catch (e) { console.error(e); }
    } else {
      if (this.wakeRecognition) {
        this.wakeRecognition.onend = null;
        this.wakeRecognition.stop();
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
