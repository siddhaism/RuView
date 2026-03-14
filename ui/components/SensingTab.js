/**
 * SensingTab — Live WiFi Sensing Visualization
 *
 * Connects to the sensing WebSocket service and renders:
 *   1. A 3D Gaussian-splat signal field (via gaussian-splats.js)
 *   2. An overlay HUD with real-time metrics (RSSI, variance, bands, classification)
 */

import { sensingService } from '../services/sensing.service.js';
import { GaussianSplatRenderer } from './gaussian-splats.js';

export class SensingTab {
  /** @param {HTMLElement} container - the #sensing section element */
  constructor(container) {
    this.container = container;
    this.splatRenderer = null;
    this._unsubData = null;
    this._unsubState = null;
    this._resizeObserver = null;
    this._threeLoaded = false;
  }

  async init() {
    this._buildDOM();
    await this._loadThree();
    this._initSplatRenderer();
    this._connectService();
    this._setupResize();
  }

  // ---- DOM construction --------------------------------------------------

  _buildDOM() {
    this.container.innerHTML = `
      <h2>Live WiFi Sensing</h2>

      <!-- Data-source status banner — updated by _onStateChange -->
      <div id="sensingSourceBanner" class="sensing-source-banner sensing-source-reconnecting"
           role="status" aria-live="polite">
        RECONNECTING...
      </div>

      <div class="sensing-layout">
        <!-- 3D viewport -->
        <div class="sensing-viewport" id="sensingViewport">
          <div class="sensing-loading">Loading 3D engine...</div>
        </div>

        <!-- Side panel -->
        <div class="sensing-panel">
          <!-- Connection -->
          <div class="sensing-card">
            <div class="sensing-card-title">Connection</div>
            <div class="sensing-connection">
              <span class="sensing-dot" id="sensingDot"></span>
              <span id="sensingState">Connecting...</span>
              <span class="sensing-source" id="sensingSource"></span>
            </div>
          </div>

          <!-- RSSI -->
          <div class="sensing-card">
            <div class="sensing-card-title">RSSI</div>
            <div class="sensing-big-value" id="sensingRssi">-- dBm</div>
            <canvas id="sensingSparkline" width="200" height="40"></canvas>
          </div>

          <!-- Signal Features -->
          <div class="sensing-card">
            <div class="sensing-card-title">Signal Features</div>
            <div class="sensing-meters">
              <div class="sensing-meter">
                <label>Variance</label>
                <div class="sensing-bar"><div class="sensing-bar-fill" id="barVariance"></div></div>
                <span class="sensing-meter-val" id="valVariance">0</span>
              </div>
              <div class="sensing-meter">
                <label>Motion Band</label>
                <div class="sensing-bar"><div class="sensing-bar-fill motion" id="barMotion"></div></div>
                <span class="sensing-meter-val" id="valMotion">0</span>
              </div>
              <div class="sensing-meter">
                <label>Breathing Band</label>
                <div class="sensing-bar"><div class="sensing-bar-fill breath" id="barBreath"></div></div>
                <span class="sensing-meter-val" id="valBreath">0</span>
              </div>
              <div class="sensing-meter">
                <label>Spectral Power</label>
                <div class="sensing-bar"><div class="sensing-bar-fill spectral" id="barSpectral"></div></div>
                <span class="sensing-meter-val" id="valSpectral">0</span>
              </div>
            </div>
          </div>

          <!-- Classification -->
          <div class="sensing-card">
            <div class="sensing-card-title">Classification</div>
            <div class="sensing-classification" id="sensingClassification">
              <div class="sensing-class-label" id="classLabel">ABSENT</div>
              <div class="sensing-confidence">
                <label>Confidence</label>
                <div class="sensing-bar"><div class="sensing-bar-fill confidence" id="barConfidence"></div></div>
                <span class="sensing-meter-val" id="valConfidence">0%</span>
              </div>
            </div>
          </div>

          <!-- Connected Nodes -->
          <div class="sensing-card">
            <div class="sensing-card-title">Connected Nodes</div>
            <div id="sensingNodes" class="sensing-nodes">
              <div class="sensing-nodes-empty">No nodes detected</div>
            </div>
          </div>

          <!-- Extra info -->
          <div class="sensing-card">
            <div class="sensing-card-title">Details</div>
            <div class="sensing-details">
              <div class="sensing-detail-row">
                <span>Dominant Freq</span><span id="valDomFreq">0 Hz</span>
              </div>
              <div class="sensing-detail-row">
                <span>Change Points</span><span id="valChangePoints">0</span>
              </div>
              <div class="sensing-detail-row">
                <span>Sample Rate</span><span id="valSampleRate">--</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Three.js loading --------------------------------------------------

  async _loadThree() {
    if (window.THREE) {
      this._threeLoaded = true;
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.onload = () => {
        this._threeLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Three.js'));
      document.head.appendChild(script);
    });
  }

  // ---- Splat renderer ----------------------------------------------------

  _initSplatRenderer() {
    const viewport = this.container.querySelector('#sensingViewport');
    if (!viewport) return;

    // Remove loading message
    viewport.innerHTML = '';

    try {
      this.splatRenderer = new GaussianSplatRenderer(viewport, {
        width: viewport.clientWidth,
        height: viewport.clientHeight || 500,
      });
    } catch (e) {
      console.error('[SensingTab] Failed to init splat renderer:', e);
      viewport.innerHTML = '<div class="sensing-loading">3D rendering unavailable</div>';
    }
  }

  // ---- Service connection ------------------------------------------------

  _connectService() {
    sensingService.start();

    this._unsubData = sensingService.onData((data) => this._onSensingData(data));
    this._unsubState = sensingService.onStateChange((state) => this._onStateChange(state));
  }

  _onSensingData(data) {
    // Update 3D view
    if (this.splatRenderer) {
      this.splatRenderer.update(data);
    }

    // Update HUD
    this._updateHUD(data);
  }

  _onStateChange(state) {
    const dot    = this.container.querySelector('#sensingDot');
    const text   = this.container.querySelector('#sensingState');
    const banner = this.container.querySelector('#sensingSourceBanner');

    if (dot && text) {
      const stateLabels = {
        disconnected: 'Disconnected',
        connecting:   'Connecting...',
        connected:    'Connected',
        reconnecting: 'Reconnecting...',
        simulated:    'Simulated',
      };
      dot.className = 'sensing-dot ' + state;
      text.textContent = stateLabels[state] || state;
    }

    if (banner) {
      // Map the service's dataSource to banner text and CSS modifier class.
      const dataSource = sensingService.dataSource;
      const bannerConfig = {
        'live':              { text: 'LIVE \u2014 ESP32 HARDWARE',           cls: 'sensing-source-live' },
        'server-simulated':  { text: 'SIMULATED \u2014 NO HARDWARE',        cls: 'sensing-source-server-sim' },
        'reconnecting':      { text: 'RECONNECTING...',                    cls: 'sensing-source-reconnecting' },
        'simulated':         { text: 'OFFLINE \u2014 CLIENT SIMULATION',    cls: 'sensing-source-simulated' },
      };
      const cfg = bannerConfig[dataSource] || bannerConfig.reconnecting;
      banner.textContent = cfg.text;
      banner.className = 'sensing-source-banner ' + cfg.cls;
    }
  }

  // ---- HUD update --------------------------------------------------------

  _updateHUD(data) {
    const f = data.features || {};
    const c = data.classification || {};

    // RSSI
    this._setText('sensingRssi', `${(f.mean_rssi || -80).toFixed(1)} dBm`);
    this._setText('sensingSource', data.source || '');

    // Bars (scale to 0-100%)
    this._setBar('barVariance', f.variance, 10, 'valVariance', f.variance);
    this._setBar('barMotion', f.motion_band_power, 0.5, 'valMotion', f.motion_band_power);
    this._setBar('barBreath', f.breathing_band_power, 0.3, 'valBreath', f.breathing_band_power);
    this._setBar('barSpectral', f.spectral_power, 2.0, 'valSpectral', f.spectral_power);

    // Classification
    const label = this.container.querySelector('#classLabel');
    if (label) {
      const level = (c.motion_level || 'absent').toUpperCase();
      label.textContent = level;
      label.className = 'sensing-class-label ' + (c.motion_level || 'absent');
    }

    const confPct = ((c.confidence || 0) * 100).toFixed(0);
    this._setBar('barConfidence', c.confidence, 1.0, 'valConfidence', confPct + '%');

    // Details
    this._setText('valDomFreq', (f.dominant_freq_hz || 0).toFixed(3) + ' Hz');
    this._setText('valChangePoints', String(f.change_points || 0));
    const srcLabel = (data.source === 'simulated' || data.source === 'simulate') ? 'sim' : data.source || 'live';
    this._setText('valSampleRate', srcLabel);

    // Sparkline
    this._drawSparkline();

    // Node panel
    this._updateNodes(data.nodes || []);
  }

  _updateNodes(nodes) {
    const container = this.container.querySelector('#sensingNodes');
    if (!container) return;

    if (!nodes.length) {
      container.innerHTML = '<div class="sensing-nodes-empty">No nodes detected</div>';
      return;
    }

    // Track per-node packet counts for rate calculation
    if (!this._nodeStats) this._nodeStats = {};
    const now = Date.now();

    container.innerHTML = nodes.map(node => {
      const id = node.node_id;
      const rssi = (node.rssi_dbm || -80).toFixed(1);
      const subs = node.subcarrier_count || node.amplitude?.length || 0;

      // Calculate packet rate
      if (!this._nodeStats[id]) this._nodeStats[id] = { count: 0, lastReset: now };
      this._nodeStats[id].count++;
      const elapsed = (now - this._nodeStats[id].lastReset) / 1000;
      const rate = elapsed > 0 ? (this._nodeStats[id].count / elapsed).toFixed(1) : '0.0';
      if (elapsed > 5) { this._nodeStats[id] = { count: 0, lastReset: now }; }

      // RSSI signal quality
      const rssiVal = parseFloat(rssi);
      const quality = rssiVal > -50 ? 'strong' : rssiVal > -70 ? 'good' : rssiVal > -85 ? 'weak' : 'poor';

      const ip = node.ip || '--';
      const ch = node.channel ? `Ch ${node.channel}` : '--';

      return `
        <div class="sensing-node-item">
          <div class="sensing-node-header">
            <span class="sensing-node-dot ${quality}"></span>
            <span class="sensing-node-id">Node ${id}</span>
            <span class="sensing-node-badge">${quality}</span>
          </div>
          <div class="sensing-node-stats">
            <div class="sensing-detail-row"><span>IP</span><span>${ip}</span></div>
            <div class="sensing-detail-row"><span>RSSI</span><span>${rssi} dBm</span></div>
            <div class="sensing-detail-row"><span>Channel</span><span>${ch}</span></div>
            <div class="sensing-detail-row"><span>Subcarriers</span><span>${subs}</span></div>
            <div class="sensing-detail-row"><span>Rate</span><span>${rate} pkt/s</span></div>
          </div>
        </div>`;
    }).join('');
  }

  _setText(id, text) {
    const el = this.container.querySelector('#' + id);
    if (el) el.textContent = text;
  }

  _setBar(barId, value, maxVal, valId, displayVal) {
    const bar = this.container.querySelector('#' + barId);
    if (bar) {
      const pct = Math.min(100, Math.max(0, ((value || 0) / maxVal) * 100));
      bar.style.width = pct + '%';
    }
    if (valId && displayVal != null) {
      const el = this.container.querySelector('#' + valId);
      if (el) el.textContent = typeof displayVal === 'number' ? displayVal.toFixed(3) : displayVal;
    }
  }

  _drawSparkline() {
    const canvas = this.container.querySelector('#sensingSparkline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const history = sensingService.getRssiHistory();
    if (history.length < 2) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...history) - 2;
    const max = Math.max(...history) + 2;
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = '#32b8c6';
    ctx.lineWidth = 1.5;

    for (let i = 0; i < history.length; i++) {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((history[i] - min) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ---- Resize ------------------------------------------------------------

  _setupResize() {
    const viewport = this.container.querySelector('#sensingViewport');
    if (!viewport || !window.ResizeObserver) return;

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (this.splatRenderer) {
          this.splatRenderer.resize(entry.contentRect.width, entry.contentRect.height);
        }
      }
    });
    this._resizeObserver.observe(viewport);
  }

  // ---- Cleanup -----------------------------------------------------------

  dispose() {
    if (this._unsubData) this._unsubData();
    if (this._unsubState) this._unsubState();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.splatRenderer) this.splatRenderer.dispose();
    sensingService.stop();
  }
}
