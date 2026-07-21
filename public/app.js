const API_BASE = '/.netlify/functions';

const WALLET_ENDPOINTS = {
  ethereum: 'wallets-eth',
  robinhood: 'wallets-robinhood',
  solana: 'wallets-solana'
};

const app = {
  wallets: [],
  watchlist: [],
  chatHistory: [],
  walletSignals: [],
  newsItems: [],
  trends: [],
  recognition: null,
  wakeRecognition: null,
  isListening: false,
  synth: window.speechSynthesis,
  sectionsOpen: { wallets: false, updates: false, watchlist: false },

  async init() {
    this.loadWallets();
    this.renderWallets();
    this.loadWatchlist();
    this.renderWatchlist();

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

    await this.refresh();
    setInterval(() => this.refresh(), 5 * 60 * 1000);
  },

  toggleSection(name) {
    const isOpen = this.sectionsOpen[name];
    this.sectionsOpen[name] = !isOpen;
    document.getElementById(`${name}Body`).style.display = isOpen ? 'none' : 'block';
    document.getElementById(`${name}Chevron`).classList.toggle('open', !isOpen);
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
      mint: data.mint, level: data.level, score: data.score,
      concentrationPct: data.concentrationPct, checkedAt: data.checkedAt,
      flags: data.flags
    });
    this.watchlist = this.watchlist.slice(0, 50);
    this.saveWatchlist();
    this.renderWatchlist();
    input.value = '';
  },

  renderTokenCheck(data, el) {
    const flagsHtml = data.flags.map(f => `
      <div class="flag-item"><span class="flag-dot ${f.severity}"></span><span class="flag-text">${f.label}</span></div>
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
      return `
        <div class="watchlist-card">
          <div class="wl-top"><span class="wl-mint">${short}</span><span class="risk-badge ${w.level}">${w.level}</span></div>
          <div class="wl-time">${this.timeAgo(w.checkedAt)}</div>
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

      document.getElementById('updatesSummary').textContent = `${this.newsItems.length} new`;
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

  renderWalletSignals() {
    const log = document.getElementById('walletSignalLog');
    if (this.walletSignals.length === 0) {
      log.innerHTML = '<div class="empty-note">No wallet activity yet.</div>';
      return;
    }
    log.innerHTML = this.walletSignals.slice(0, 25).map(s => `
      <div class="signal-row">
        <span class="signal-tag wallet">wallet</span>
        <div style="flex:1;">
          <div class="signal-title">${s.title}</div>
          <div class="signal-sub">${s.subtitle || ''}</div>
        </div>
        <div class="signal-time">${s.ago || ''}</div>
      </div>`).join('');
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
        <div class="meta">${n.subtitle} · ${n.ago}</div>
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

  // ---------- Chat (with full history/context) ----------
  async sendChat(spokenText) {
    const input = document.getElementById('chatInput');
    const message = spokenText || input.value.trim();
    if (!message) return;
    input.value = '';

    this.appendChatBubble('user', message);
    const thinkingEl = this.appendChatBubble('assistant', 'Thinking...', true);

    const context = {
      watchedWallets: this.wallets,
      watchlist: this.watchlist,
      walletSignals: this.walletSignals.slice(0, 50),
      newsItems: this.newsItems,
      trendingTopics: this.trends
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
      this.appendChatBubble('assistant', data.reply);
      this.speak(data.reply);
      this.chatHistory.push({ role: 'user', content: message });
      this.chatHistory.push({ role: 'assistant', content: data.reply });
    } catch (err) {
      thinkingEl.remove();
      this.appendChatBubble('assistant', `Error: ${err.message}`);
    }
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

  // ---------- Wake word ("J7 activate") ----------
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
        if (transcript.includes('j7 activate') || transcript.includes('j seven activate')) {
          this.wakeRecognition.stop();
          this.toggleVoiceInput();
        }
      };
      this.wakeRecognition.onend = () => {
        // Restart automatically if still enabled, browsers auto-stop after a while
        if (document.getElementById('wakeWordToggle').checked) {
          try { this.wakeRecognition.start(); } catch (e) { /* already running */ }
        }
      };
      this.wakeRecognition.onerror = (e) => {
        console.error('Wake word listener error:', e.error);
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
