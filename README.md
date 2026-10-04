# WinGo Real-Time Multi-Game Prediction & Analytics Studio

A real-time analysis dashboard, pattern recognition engine, and strategy backtesting simulator directly synchronized with **51Game WinGo** live draws.

---

## 🌟 Key Features

### 1. 4 Real-Time Game Modes (All 4 Time Logs)
Switch seamlessly between all 4 official WinGo game intervals:
- ⚡ **Win Go 30S** (30-second rapid cycle, `typeId: 30`)
- ⏱️ **Win Go 1Min** (1-minute cycle, `typeId: 1`)
- ⏳ **Win Go 3Min** (3-minute cycle, `typeId: 2`)
- 🕒 **Win Go 5Min** (5-minute cycle, `typeId: 3`)

Each tab maintains its own independent live history stream, server countdown synchronization, bead road matrix, and predictive intelligence models.

### 2. Live Real-Time 51Game API Stream
* **No Mock Data**: Automatically connects to the live 51Game backend API (`api.api51gameapi.com`) using authentic cryptographic signatures (MD5 request hashing).
* **Server Time Synchronization**: The circular timer syncs directly with 51Game's server issue start/end timestamps.
* **Instant Outcome Auditing**: When a round concludes on 51Game, the new winning number is fetched automatically, audited against the prediction made for that period, and recorded into your performance log.

### 3. Multi-Model Prediction Engine (Ensemble System)
* **Markov State Transition Model**: Calculates empirical transition probabilities ($P(Big \to Big)$, $P(Big \to Small)$, etc.) from the live window.
* **Sequence Pattern Matcher**: Detects alternating sequences ($AB-AB$), double patterns ($AABB$), and mirror sequences.
* **Dragon / Streak Momentum**: Analyzes consecutive streaks of Big/Small and Color, identifying continuation momentum vs. dragon-cut reversal points.
* **Mean Reversion / Cold Frequency**: Detects numbers and parity states lagging behind standard statistical distribution.
* **Consensus Aggregator**: Outputs **Primary Pick** (Big vs Small with confidence %), **Suggested Color**, and **Top 3 High-Probability Numbers**.

### 4. Casino Bead Road (珠盘路) & Visual Analytics
* Live 2D Bead Road matrix mapping actual drawn numbers and colors.
* Real-time **0–9 Frequency Bar Chart** with *Hot* (fire) and *Cold* (frost) badges.
* Live ratio distribution bars for Big vs Small and Green vs Red vs Violet.

### 5. History Audit Table (50 Draws / 10 Per Page)
* Pulls up to **50 live historical draws** directly from 51Game API.
* **10-per-page pagination**: Features interactive `[Previous]`, `[1]`, `[2]`, `[3]`, `[4]`, `[5]`, and `[Next]` navigation buttons.
* Side-by-side audit of period IDs, winning numbers, colors, model calls, and simulated profit/loss.
* Filterable dynamically by `All`, `Big`, `Small`, `Green`, `Red` with pagination preserved.

### 6. Money Management & Strategy Simulator
* Tests staking systems in real time with virtual units:
  * **Flat Staking** (1 unit fixed)
  * **3-Stage Martingale** (1 $\to$ 2 $\to$ 4 units, reset on win or 3 losses)
  * **Paroli / Anti-Martingale** (win-streak accelerator)
  * **D'Alembert** (+1 unit on loss, -1 unit on win)
* Live tracking of Win Rate %, Win Streaks, and Max Drawdown.

---

## 🚀 How to Run

### Method 1: One-Click Launch (Windows)
Double-click [**`start.bat`**](file:///c:/Users/VENKATA%20PAVAN%20KUMAR/Downloads/wingo-prediction-app/start.bat) in the project folder.

### Method 2: Python Server
In PowerShell:
```powershell
python "c:\Users\VENKATA PAVAN KUMAR\Downloads\wingo-prediction-app\server.py"
```
It will automatically bind an available port (e.g. `http://localhost:8088`) and launch your default browser.

### Method 3: Direct Browser Open
Double-click [**`index.html`**](file:///c:/Users/VENKATA%20PAVAN%20KUMAR/Downloads/wingo-prediction-app/index.html) or open it in any browser (Chrome, Edge, Firefox, Brave).

---

## ⚠️ Educational & Probability Disclaimer
Win Go outcomes are generated on remote servers via PRNG. Each round is an independent random event (Gambler's Fallacy). This tool provides data visualization, pattern recognition, and backtesting for statistical study and simulation.
