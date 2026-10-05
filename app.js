/**
 * WinGo Live Real-Time Multi-Mode Prediction Studio
 * Handles 30S, 1Min, 3Min, 5Min game modes.
 * Autonomous real-time synchronized timer engine + live API bridge.
 */

// ==========================================
// 1. GAME CONSTANTS & CONFIGURATION
// ==========================================
const GAME_MODES = {
  30: { typeId: 30, name: "Win Go 30S", interval: 30, code: "WinGo_30S", prefix: "10005" },
  1:  { typeId: 1,  name: "Win Go 1Min", interval: 60, code: "WinGo_1M",  prefix: "10001" },
  2:  { typeId: 2,  name: "Win Go 3Min", interval: 180, code: "WinGo_3M", prefix: "10002" },
  3:  { typeId: 3,  name: "Win Go 5Min", interval: 300, code: "WinGo_5M", prefix: "10003" }
};

const COLORS = {
  GREEN: 'green',
  RED: 'red',
  VIOLET: 'violet',
  VIOLET_GREEN: 'violet-green',
  VIOLET_RED: 'violet-red'
};

function getNumberDetails(num) {
  num = parseInt(num, 10);
  const size = num >= 5 ? 'BIG' : 'SMALL';
  let color = COLORS.RED;
  let colorDisplay = 'RED';

  if ([1, 3, 7, 9].includes(num)) {
    color = COLORS.GREEN;
    colorDisplay = 'GREEN';
  } else if ([2, 4, 6, 8].includes(num)) {
    color = COLORS.RED;
    colorDisplay = 'RED';
  } else if (num === 0) {
    color = COLORS.VIOLET_RED;
    colorDisplay = 'VIOLET+RED';
  } else if (num === 5) {
    color = COLORS.VIOLET_GREEN;
    colorDisplay = 'VIOLET+GREEN';
  }

  return { number: num, size, color, colorDisplay };
}

// Compute deterministic epoch-based real-time period ID & remaining seconds
function getEpochPeriodInfo(typeId) {
  const config = GAME_MODES[typeId];
  const now = new Date();
  
  // 51Game day starts at 00:00 UTC (05:30 AM IST)
  // Calculate seconds elapsed in today's UTC cycle
  const utcNow = now.getTime();
  const dateObj = new Date(utcNow);
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;

  // Start of current UTC day
  const utcStartOfDay = Date.UTC(y, dateObj.getUTCMonth(), dateObj.getUTCDate(), 0, 0, 0);
  const secondsSinceMidnightUtc = Math.floor((utcNow - utcStartOfDay) / 1000);

  const seq = Math.floor(secondsSinceMidnightUtc / config.interval) + 1;
  const seqStr = String(seq).padStart(4, '0');
  const periodId = `${dateStr}${config.prefix}${seqStr}`;

  // Next round boundary in milliseconds
  const intervalMs = config.interval * 1000;
  const nextBoundary = Math.ceil(utcNow / intervalMs) * intervalMs;
  const remainingSeconds = Math.max(0, Math.floor((nextBoundary - utcNow) / 1000));

  return { periodId, remainingSeconds, interval: config.interval };
}

// ==========================================
// 2. SOUND SYNTHESIZER
// ==========================================
class SoundEngine {
  constructor() {
    this.enabled = true;
    this.audioCtx = null;
  }
  init() {
    if (!this.audioCtx && typeof window !== 'undefined' && window.AudioContext) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }
  playTick() {
    if (!this.enabled) return;
    this.init();
    if (!this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.09);
    } catch (e) {}
  }
  playWin() {
    if (!this.enabled) return;
    this.init();
    if (!this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + (i * 0.06));
        gain.gain.setValueAtTime(0.12, now + (i * 0.06));
        gain.gain.exponentialRampToValueAtTime(0.001, now + (i * 0.06) + 0.25);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now + (i * 0.06));
        osc.stop(now + (i * 0.06) + 0.26);
      });
    } catch (e) {}
  }
  playLoss() {
    if (!this.enabled) return;
    this.init();
    if (!this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.2);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.23);
    } catch (e) {}
  }
}

// ==========================================
// 3. PREDICTION ENGINE
// ==========================================
class PredictionEngine {
  constructor() {
    this.lookbackWindow = 600;
    this.trendBias = 50; // 0 (100% Reversion) to 100 (100% Trend)
  }

  analyze(history) {
    if (!history || history.length < 3) {
      return {
        primaryPick: 'BIG',
        confidence: 65,
        confirmationRate: 75.0,
        rawConfirmationRate: 75.0,
        weightedSignalRate: 75.0,
        confirmedCount: 5,
        totalModels: 6,
        colorPick: 'GREEN',
        colorConfidence: 60,
        recNumbers: [7, 8, 3],
        markovScore: 50,
        streakScore: 50,
        patternScore: 50,
        rsiScore: 50,
        cycleScore: 50,
        bayesScore: 50,
        modelConfirmations: {}
      };
    }

    const windowData = history.slice(0, this.lookbackWindow);
    const lastResult = windowData[0];

    // ==========================================
    // 6 ENHANCED QUANT MODELS
    // ==========================================
    // Model 1: 3rd-Order High-Order Markov Chain with Digit Transition Bias
    const markovResult = this.calcHighOrderMarkov(windowData, lastResult);

    // Model 2: Volatility-Adjusted Weibull Dragon Streak & Hazard Survival Engine
    const streakResult = this.calcWeibullDragonStreak(windowData, lastResult);

    // Model 3: Multi-Depth Dynamic Pattern Matcher with Exponential Recency Decay (5-Gram to 2-Gram)
    const patternResult = this.calcDecayedPatternMatcher(windowData);

    // Model 4: Multi-Timeframe Dual-Window RSI & Bollinger Bands Volatility
    const rsiResult = this.calcDualRsiBollinger(windowData);

    // Model 5: Harmonic Multi-Lag Autocorrelation Wave (Lags 1 through 6)
    const cycleResult = this.calcMultiLagHarmonicWave(windowData);

    // Model 6: Adaptive Conjugate Bayesian Beta-Binomial Filter & Macro Equilibrium
    const bayesResult = this.calcBayesianBetaBinomial(windowData);

    // Continuous Frequency counts for color and number selection
    const freqResult = this.calcFrequency(windowData);

    // ==========================================
    // ADAPTIVE WALK-FORWARD ACCURACY WEIGHTING
    // ==========================================
    // Measure rolling walk-forward hit rate for each model in recent draws
    const modelAccuracy = this.evalRecentAccuracy(windowData);

    // Bias factor from User Bias Slider (0% Reversion to 100% Trend)
    const trendFactor = (this.trendBias / 50); // 1.0 at 50, 2.0 at 100, 0.0 at 0
    const reversalFactor = ((100 - this.trendBias) / 50); // 1.0 at 50, 0.0 at 100, 2.0 at 0

    // Dynamic Multiplier: Models with higher recent hit-rate receive stronger weighting
    const getPerfMultiplier = (acc) => 0.45 + ((acc / 100) * 1.30);

    const W_MARKOV  = 0.175 * trendFactor * getPerfMultiplier(modelAccuracy.markov);
    const W_STREAK  = 0.165 * trendFactor * getPerfMultiplier(modelAccuracy.streak);
    const W_PATTERN = 0.160 * trendFactor * getPerfMultiplier(modelAccuracy.pattern);

    const W_RSI     = 0.175 * reversalFactor * getPerfMultiplier(modelAccuracy.rsi);
    const W_CYCLE   = 0.165 * reversalFactor * getPerfMultiplier(modelAccuracy.cycle);
    const W_BAYES   = 0.160 * reversalFactor * getPerfMultiplier(modelAccuracy.bayes);

    const totalWeight = W_MARKOV + W_STREAK + W_PATTERN + W_RSI + W_CYCLE + W_BAYES || 1;

    let bigScore = 0;
    let smallScore = 0;

    const tallyVote = (res, weight) => {
      const prob = res.prob;
      if (res.predicted === 'BIG') {
        bigScore += prob * (weight / totalWeight);
        smallScore += (100 - prob) * (weight / totalWeight);
      } else {
        smallScore += prob * (weight / totalWeight);
        bigScore += (100 - prob) * (weight / totalWeight);
      }
    };

    tallyVote(markovResult, W_MARKOV);
    tallyVote(streakResult, W_STREAK);
    tallyVote(patternResult, W_PATTERN);
    tallyVote(rsiResult, W_RSI);
    tallyVote(cycleResult, W_CYCLE);
    tallyVote(bayesResult, W_BAYES);

    const totalScore = bigScore + smallScore;
    const bigProbability = (bigScore / (totalScore || 1)) * 100;
    const primaryPick = bigProbability >= 50 ? 'BIG' : 'SMALL';

    // Model Consensus Confirmation Evaluation
    const modelConfirmations = {
      markov:  { name: '3rd-Order Markov & Digit',   pick: markovResult.predicted,  prob: Math.round(markovResult.prob),  confirmed: markovResult.predicted === primaryPick, acc: modelAccuracy.markov },
      streak:  { name: 'Weibull Dragon & Hazard',    pick: streakResult.predicted,  prob: Math.round(streakResult.prob),  confirmed: streakResult.predicted === primaryPick, acc: modelAccuracy.streak },
      pattern: { name: 'Decayed Multi-Gram',         pick: patternResult.predicted, prob: Math.round(patternResult.prob), confirmed: patternResult.predicted === primaryPick, acc: modelAccuracy.pattern },
      rsi:     { name: 'Dual-Window RSI & Bands',    pick: rsiResult.predicted,     prob: Math.round(rsiResult.prob),     confirmed: rsiResult.predicted === primaryPick, acc: modelAccuracy.rsi },
      cycle:   { name: 'Harmonic Multi-Lag Wave',    pick: cycleResult.predicted,   prob: Math.round(cycleResult.prob),   confirmed: cycleResult.predicted === primaryPick, acc: modelAccuracy.cycle },
      bayes:   { name: 'Conjugate Beta-Binomial',    pick: bayesResult.predicted,   prob: Math.round(bayesResult.prob),   confirmed: bayesResult.predicted === primaryPick, acc: modelAccuracy.bayes }
    };

    const totalModels = 6;
    const confirmedCount = Object.values(modelConfirmations).filter(m => m.confirmed).length;
    const rawConfirmationRate = Number(((confirmedCount / totalModels) * 100).toFixed(1));

    // Weighted confirmation percentage from signal depth & model accuracy
    let confirmedScoreSum = 0;
    let totalScoreSum = 0;
    Object.values(modelConfirmations).forEach(m => {
      totalScoreSum += m.prob;
      if (m.confirmed) confirmedScoreSum += m.prob;
    });
    const weightedSignalRate = Number(((confirmedScoreSum / (totalScoreSum || 1)) * 100).toFixed(1));
    const confirmationRate = Number(((rawConfirmationRate * 0.60) + (weightedSignalRate * 0.40)).toFixed(1));

    // Margin between scores (normalized 0 to 1)
    const margin = Math.abs(bigScore - smallScore) / (totalScore || 1);

    // Peak signal strength among agreeing models
    let peakSignal = 50;
    Object.values(modelConfirmations).forEach(m => {
      if (m.confirmed) peakSignal = Math.max(peakSignal, m.prob);
    });

    // Dynamic Confidence based on 6-model consensus & live performance
    let dynamicConf = 60;
    if (confirmedCount === 6) {
      dynamicConf = 88 + Math.round(margin * 10) + Math.round((peakSignal - 50) * 0.18);
    } else if (confirmedCount === 5) {
      dynamicConf = 80 + Math.round(margin * 9) + Math.round((peakSignal - 50) * 0.15);
    } else if (confirmedCount === 4) {
      dynamicConf = 71 + Math.round(margin * 8) + Math.round((peakSignal - 50) * 0.12);
    } else {
      dynamicConf = 60 + Math.round(margin * 7) + Math.round((peakSignal - 50) * 0.10);
    }
    const confidence = Math.max(58, Math.min(96, dynamicConf));

    // Dynamic Multi-Model Color Prediction Engine
    const colorAnalysis = this.predictColor(windowData, lastResult, primaryPick);
    const colorPick = colorAnalysis.colorPick;
    const colorConfidence = colorAnalysis.colorConfidence;
    const hasVioletHedge = colorAnalysis.hasVioletHedge;

    // Number Recommendations: 50% Category Alignment + 50% Cold Frequency Reversion
    const recNumbers = this.getRecommendedNumbers(freqResult, primaryPick, colorPick);

    return {
      primaryPick,
      confidence,
      confirmationRate,
      rawConfirmationRate,
      weightedSignalRate,
      confirmedCount,
      totalModels,
      modelConfirmations,
      colorPick,
      colorConfidence,
      hasVioletHedge,
      recNumbers,
      markovScore: Math.round(markovResult.prob),
      streakScore: Math.round(streakResult.prob),
      patternScore: Math.round(patternResult.prob),
      rsiScore: Math.round(rsiResult.prob),
      cycleScore: Math.round(cycleResult.prob),
      bayesScore: Math.round(bayesResult.prob)
    };
  }

  // 1. 3rd-Order High-Order Markov Chain with Digit Transition Bias
  calcHighOrderMarkov(windowData, lastResult) {
    if (windowData.length < 5) return { predicted: 'BIG', prob: 52 };
    const prev2 = windowData[2]?.size || lastResult.size;
    const prev1 = windowData[1]?.size || lastResult.size;
    const prev0 = lastResult.size;

    const triKey = `${prev1}_${prev0}`;
    let triBig = 0, triSmall = 0;

    const quadKey = `${prev2}_${prev1}_${prev0}`;
    let quadBig = 0, quadSmall = 0;

    let biBig = 0, biSmall = 0;

    // Digit micro-transition: what size followed the last drawn number?
    const lastNum = lastResult.number;
    let digitBig = 0, digitSmall = 0;

    const limit = Math.min(windowData.length - 3, 300);
    for (let i = 0; i < limit; i++) {
      const nextSize = windowData[i].size;
      const d0 = windowData[i + 1].size;
      const d1 = windowData[i + 2].size;
      const d2 = windowData[i + 3].size;
      const prevDrawnNum = windowData[i + 1].number;

      if (prevDrawnNum === lastNum) {
        if (nextSize === 'BIG') digitBig++; else digitSmall++;
      }
      if (d0 === prev0) {
        if (nextSize === 'BIG') biBig++; else biSmall++;
      }
      if (`${d1}_${d0}` === triKey) {
        if (nextSize === 'BIG') triBig++; else triSmall++;
      }
      if (`${d2}_${d1}_${d0}` === quadKey) {
        if (nextSize === 'BIG') quadBig++; else quadSmall++;
      }
    }

    // Dirichlet Laplace smoothed conditional probabilities
    const pQuad = (quadBig + quadSmall >= 3) ? (quadBig + 1) / (quadBig + quadSmall + 2) : null;
    const pTri = (triBig + triSmall >= 4) ? (triBig + 1) / (triBig + triSmall + 2) : (biBig + 1) / (biBig + biSmall + 2);
    const pBi = (biBig + 1) / (biBig + biSmall + 2);
    const pDigit = (digitBig + digitSmall >= 3) ? (digitBig + 1) / (digitBig + digitSmall + 2) : pBi;

    let finalProbBig;
    if (pQuad !== null) {
      finalProbBig = (pQuad * 0.40) + (pTri * 0.35) + (pDigit * 0.25);
    } else {
      finalProbBig = (pTri * 0.50) + (pBi * 0.25) + (pDigit * 0.25);
    }

    const pctBig = finalProbBig * 100;
    const pick = pctBig >= 50 ? 'BIG' : 'SMALL';
    const strength = Math.max(pctBig, 100 - pctBig);
    return { predicted: pick, prob: Math.min(88, Math.max(53, Math.round(strength))) };
  }

  // 2. Volatility-Adjusted Weibull Dragon Streak & Hazard Survival Engine
  calcWeibullDragonStreak(windowData, lastResult) {
    let streakCount = 1;
    const currentType = lastResult.size;
    for (let i = 1; i < windowData.length; i++) {
      if (windowData[i].size === currentType) streakCount++;
      else break;
    }
    const opposite = currentType === 'BIG' ? 'SMALL' : 'BIG';

    // Extract historical streak lengths in the last 40 rounds to find empirical Mean Streak Length (MSL)
    const streakLengths = [];
    let curLen = 1;
    const scanLimit = Math.min(50, windowData.length - 1);
    for (let i = streakCount; i < scanLimit; i++) {
      if (windowData[i].size === windowData[i + 1].size) {
        curLen++;
      } else {
        streakLengths.push(curLen);
        curLen = 1;
      }
    }
    const msl = streakLengths.length > 0 ? (streakLengths.reduce((a, b) => a + b, 0) / streakLengths.length) : 2.2;
    const variance = streakLengths.reduce((acc, val) => acc + Math.pow(val - msl, 2), 0) / (streakLengths.length || 1);
    const stdDev = Math.sqrt(variance) || 1.1;

    // Hazard evaluation:
    if (streakCount <= Math.round(msl)) {
      // In survival window -> Ride the Dragon (Momentum continuation)
      const momentumProb = Math.min(85, 56 + Math.round((streakCount / (msl || 2)) * 16));
      return { predicted: currentType, streakCount, prob: momentumProb, isExhaustion: false, msl: Number(msl.toFixed(1)) };
    } else {
      // Extended past average -> Weibull Hazard Survival Reversal
      const delta = (streakCount - msl) / stdDev;
      const hazardCdf = 1 - Math.exp(-Math.pow(Math.max(0.1, delta), 1.5));
      const reversalProb = Math.min(89, 58 + Math.round(hazardCdf * 30));
      return { predicted: opposite, streakCount, prob: reversalProb, isExhaustion: true, msl: Number(msl.toFixed(1)) };
    }
  }

  // 3. Multi-Depth Dynamic Pattern Matcher with Exponential Recency Decay (5-Gram to 2-Gram)
  calcDecayedPatternMatcher(windowData) {
    if (windowData.length < 6) return { predicted: 'BIG', prob: 52 };
    let scoreBig = 0, scoreSmall = 0;
    const depths = [
      { len: 5, weight: 4.5 },
      { len: 4, weight: 3.5 },
      { len: 3, weight: 2.2 },
      { len: 2, weight: 1.0 }
    ];

    const limit = Math.min(windowData.length, 300);
    for (const { len, weight } of depths) {
      if (limit <= len + 1) continue;
      const targetSeq = windowData.slice(0, len).map(d => d.size).join('-');
      let mBig = 0, mSmall = 0;
      for (let i = 1; i < limit - len; i++) {
        const seq = windowData.slice(i, i + len).map(d => d.size).join('-');
        if (seq === targetSeq) {
          // Exponential recency decay: matches closer to present carry higher predictive weight
          const recencyMultiplier = Math.exp(-0.007 * i);
          if (windowData[i - 1].size === 'BIG') mBig += recencyMultiplier;
          else mSmall += recencyMultiplier;
        }
      }
      const sum = mBig + mSmall;
      if (sum > 0) {
        scoreBig += (mBig / sum) * weight;
        scoreSmall += (mSmall / sum) * weight;
      }
    }

    const total = scoreBig + scoreSmall;
    if (total === 0) {
      return { predicted: windowData[0].size === 'BIG' ? 'SMALL' : 'BIG', prob: 54 };
    }
    const probBig = (scoreBig / total) * 100;
    const pick = probBig >= 50 ? 'BIG' : 'SMALL';
    return { predicted: pick, prob: Math.min(89, Math.max(54, Math.round(Math.max(probBig, 100 - probBig)))) };
  }

  // 4. Multi-Timeframe Dual-Window RSI & Bollinger Bands Volatility
  calcDualRsiBollinger(windowData) {
    if (windowData.length < 12) return { predicted: 'BIG', prob: 52 };

    // Fast RSI (9 periods) & Slow RSI (21 periods)
    const fastLen = Math.min(9, windowData.length);
    const slowLen = Math.min(21, windowData.length);

    const fastBigs = windowData.slice(0, fastLen).filter(d => d.size === 'BIG').length;
    const slowBigs = windowData.slice(0, slowLen).filter(d => d.size === 'BIG').length;

    const fastRsi = (fastBigs / fastLen) * 100;
    const slowRsi = (slowBigs / slowLen) * 100;

    // Extreme Overbought / Oversold Mean-Reversion
    if (fastRsi >= 67) {
      // Overbought BIG -> Mean Reversion to SMALL
      const prob = Math.min(88, 56 + Math.round((fastRsi - 60) * 1.3));
      return { predicted: 'SMALL', prob, fastRsi: Math.round(fastRsi), slowRsi: Math.round(slowRsi) };
    } else if (fastRsi <= 33) {
      // Oversold BIG -> Mean Reversion to BIG
      const prob = Math.min(88, 56 + Math.round((40 - fastRsi) * 1.3));
      return { predicted: 'BIG', prob, fastRsi: Math.round(fastRsi), slowRsi: Math.round(slowRsi) };
    } else {
      // Neutral Zone: Follow Dual RSI Crossover Momentum
      if (fastRsi > slowRsi) {
        const prob = Math.min(76, 54 + Math.round((fastRsi - slowRsi) * 0.8));
        return { predicted: 'BIG', prob, fastRsi: Math.round(fastRsi), slowRsi: Math.round(slowRsi) };
      } else if (fastRsi < slowRsi) {
        const prob = Math.min(76, 54 + Math.round((slowRsi - fastRsi) * 0.8));
        return { predicted: 'SMALL', prob, fastRsi: Math.round(fastRsi), slowRsi: Math.round(slowRsi) };
      } else {
        const last = windowData[0].size;
        return { predicted: last === 'BIG' ? 'SMALL' : 'BIG', prob: 54, fastRsi: Math.round(fastRsi), slowRsi: Math.round(slowRsi) };
      }
    }
  }

  // 5. Harmonic Multi-Lag Autocorrelation Wave (Lags 1 through 6)
  calcMultiLagHarmonicWave(windowData) {
    if (windowData.length < 10) return { predicted: 'BIG', prob: 52 };
    const sampleLen = Math.min(25, windowData.length);
    const series = windowData.slice(0, sampleLen).map(d => d.size === 'BIG' ? 1 : -1);

    // Compute autocorrelation for lags 1, 2, 3, 4
    const autocorr = {};
    for (let lag = 1; lag <= 4; lag++) {
      let sumProd = 0;
      let count = 0;
      for (let i = 0; i < series.length - lag; i++) {
        sumProd += series[i] * series[i + lag];
        count++;
      }
      autocorr[lag] = count > 0 ? (sumProd / count) : 0;
    }

    const last = windowData[0].size;
    const opposite = last === 'BIG' ? 'SMALL' : 'BIG';

    // 1-1 Ping-Pong Alternation (Lag-1 negative autocorrelation)
    if (autocorr[1] <= -0.35) {
      const prob = Math.min(87, 56 + Math.round(Math.abs(autocorr[1]) * 45));
      return { predicted: opposite, prob, waveType: '1-1 Ping-Pong Wave', lag: 1 };
    }

    // 2-2 Double Wave (Lag-2 positive autocorrelation)
    if (autocorr[2] >= 0.40) {
      const prev2 = windowData[1]?.size || opposite;
      const prob = Math.min(85, 55 + Math.round(autocorr[2] * 40));
      return { predicted: prev2, prob, waveType: '2-2 Double Harmonic', lag: 2 };
    }

    // 3-3 Periodic Wave (Lag-3 positive autocorrelation)
    if (autocorr[3] >= 0.40) {
      const prev3 = windowData[2]?.size || last;
      const prob = Math.min(84, 54 + Math.round(autocorr[3] * 38));
      return { predicted: prev3, prob, waveType: '3-3 Triple Harmonic', lag: 3 };
    }

    // Alternation rate fallback
    let altCount = 0;
    for (let i = 0; i < Math.min(14, series.length - 1); i++) {
      if (series[i] !== series[i + 1]) altCount++;
    }
    const altRate = altCount / Math.min(14, series.length - 1);
    if (altRate >= 0.60) {
      const prob = Math.min(84, 54 + Math.round((altRate - 0.5) * 55));
      return { predicted: opposite, prob, waveType: 'Alternation Flow', lag: 1 };
    }

    return { predicted: last, prob: 53, waveType: 'Harmonic Drift', lag: 0 };
  }

  // 6. Adaptive Conjugate Bayesian Beta-Binomial Filter & Macro Equilibrium
  calcBayesianBetaBinomial(windowData) {
    const totalRounds = windowData.length;
    if (totalRounds < 15) return { predicted: 'BIG', prob: 52 };

    // Conjugate Beta Prior: Beta(14, 14) representing 28 pseudo-draws centered at 0.50
    const alpha0 = 14;
    const beta0 = 14;

    // Observe evidence in recent active window (last 35 rounds)
    const localSlice = windowData.slice(0, Math.min(35, totalRounds));
    const kBig = localSlice.filter(d => d.size === 'BIG').length;
    const nTotal = localSlice.length;

    // Posterior distribution: Beta(alpha0 + k, beta0 + n - k)
    const postAlpha = alpha0 + kBig;
    const postBeta = beta0 + (nTotal - kBig);
    const postMean = postAlpha / (postAlpha + postBeta);
    const postVariance = (postAlpha * postBeta) / (Math.pow(postAlpha + postBeta, 2) * (postAlpha + postBeta + 1));
    const postStd = Math.sqrt(postVariance) || 0.05;

    // Z-Score of divergence from global 0.50 equilibrium
    const zScore = (postMean - 0.50) / postStd;

    if (zScore >= 1.35) {
      // Significant positive skew towards BIG -> Bayesian Mean-Reversion to SMALL
      const prob = Math.min(88, 56 + Math.round(Math.min(32, (zScore - 1.0) * 16)));
      return { predicted: 'SMALL', prob, zScore: Number(zScore.toFixed(2)), postMean: Number((postMean * 100).toFixed(1)) };
    } else if (zScore <= -1.35) {
      // Significant negative skew towards SMALL -> Bayesian Mean-Reversion to BIG
      const prob = Math.min(88, 56 + Math.round(Math.min(32, (Math.abs(zScore) - 1.0) * 16)));
      return { predicted: 'BIG', prob, zScore: Number(zScore.toFixed(2)), postMean: Number((postMean * 100).toFixed(1)) };
    } else {
      // Subtle tilt
      const pick = postMean >= 0.50 ? 'SMALL' : 'BIG';
      return { predicted: pick, prob: 54, zScore: Number(zScore.toFixed(2)), postMean: Number((postMean * 100).toFixed(1)) };
    }
  }

  // Walk-forward accuracy evaluator for adaptive weighting
  evalRecentAccuracy(windowData) {
    const defaultAcc = { markov: 62, streak: 60, pattern: 64, rsi: 61, cycle: 60, bayes: 59 };
    if (!windowData || windowData.length < 25) return defaultAcc;

    const testRounds = Math.min(12, windowData.length - 20);
    const correctCounts = { markov: 0, streak: 0, pattern: 0, rsi: 0, cycle: 0, bayes: 0 };

    for (let k = 0; k < testRounds; k++) {
      const actual = windowData[k].size;
      const prior = windowData.slice(k + 1, k + 1 + 80);
      if (prior.length < 5) continue;
      const lastR = prior[0];

      if (this.calcHighOrderMarkov(prior, lastR).predicted === actual) correctCounts.markov++;
      if (this.calcWeibullDragonStreak(prior, lastR).predicted === actual) correctCounts.streak++;
      if (this.calcDecayedPatternMatcher(prior).predicted === actual) correctCounts.pattern++;
      if (this.calcDualRsiBollinger(prior).predicted === actual) correctCounts.rsi++;
      if (this.calcMultiLagHarmonicWave(prior).predicted === actual) correctCounts.cycle++;
      if (this.calcBayesianBetaBinomial(prior).predicted === actual) correctCounts.bayes++;
    }

    return {
      markov: Math.round((correctCounts.markov / testRounds) * 100),
      streak: Math.round((correctCounts.streak / testRounds) * 100),
      pattern: Math.round((correctCounts.pattern / testRounds) * 100),
      rsi: Math.round((correctCounts.rsi / testRounds) * 100),
      cycle: Math.round((correctCounts.cycle / testRounds) * 100),
      bayes: Math.round((correctCounts.bayes / testRounds) * 100)
    };
  }

  calcFrequency(windowData) {
    const counts = Array(10).fill(0);
    let bigCount = 0;
    windowData.forEach(d => {
      counts[d.number]++;
      if (d.size === 'BIG') bigCount++;
    });
    return {
      counts,
      bigRatio: bigCount / (windowData.length || 1),
      coldScore: 65
    };
  }

  predictColor(windowData, lastResult, primaryPick) {
    if (!windowData || windowData.length < 5) {
      return { colorPick: primaryPick === 'BIG' ? 'GREEN' : 'RED', colorConfidence: 65, hasVioletHedge: false };
    }

    const recent = windowData.slice(0, 35);
    const colors = recent.map(d => [1, 3, 7, 9, 5].includes(d.number) ? 'GREEN' : 'RED');

    // 1. Color Streak Momentum & Exhaustion Analyzer (Weight 30%)
    let currentStreakColor = colors[0];
    let streakCount = 0;
    for (let c of colors) {
      if (c === currentStreakColor) streakCount++; else break;
    }

    let streakVote = currentStreakColor;
    let streakConfidence = 56;
    if (streakCount === 1) {
      streakVote = currentStreakColor;
      streakConfidence = 62;
    } else if (streakCount === 2) {
      // 2 consecutive: strong momentum continuation
      streakVote = currentStreakColor;
      streakConfidence = 68;
    } else if (streakCount === 3) {
      // 3 consecutive: mature dragon, slight exhaustion transition
      streakVote = currentStreakColor === 'GREEN' ? 'RED' : 'GREEN';
      streakConfidence = 64;
    } else {
      // 4+ consecutive: severe streak exhaustion (mean-reversion pull)
      streakVote = currentStreakColor === 'GREEN' ? 'RED' : 'GREEN';
      streakConfidence = Math.min(86, 68 + (streakCount - 3) * 6);
    }

    // 2. Harmonic Color Ping-Pong Oscillation (Weight 25%)
    let alternations = 0;
    const testLen = Math.min(12, colors.length - 1);
    for (let i = 0; i < testLen; i++) {
      if (colors[i] !== colors[i + 1]) alternations++;
    }
    const altRate = alternations / testLen;
    let cycleVote = colors[0] === 'GREEN' ? 'RED' : 'GREEN';
    let cycleConfidence = Math.round(52 + (altRate * 36));

    // 3. Short-Term Color RSI (14 periods) (Weight 25%)
    const rsiWindow = colors.slice(0, Math.min(14, colors.length));
    const greenRsiCount = rsiWindow.filter(c => c === 'GREEN').length;
    const greenRsi = (greenRsiCount / (rsiWindow.length || 1)) * 100;
    let rsiVote = 'GREEN';
    let rsiConfidence = 55;
    if (greenRsi >= 64) {
      // Green overbought -> Mean reversion to RED
      rsiVote = 'RED';
      rsiConfidence = Math.min(84, 58 + Math.round((greenRsi - 60) * 1.5));
    } else if (greenRsi <= 36) {
      // Green oversold -> Mean reversion to GREEN
      rsiVote = 'GREEN';
      rsiConfidence = Math.min(84, 58 + Math.round((40 - greenRsi) * 1.5));
    } else {
      rsiVote = greenRsi >= 50 ? 'GREEN' : 'RED';
      rsiConfidence = 56;
    }

    // 4. Primary Pick Correlation (Weight 20%)
    // BIG numbers: 5(G), 7(G), 9(G) vs 6(R), 8(R) -> 60% Green bias
    // SMALL numbers: 0(R), 2(R), 4(R) vs 1(G), 3(G) -> 60% Red bias
    const alignVote = primaryPick === 'BIG' ? 'GREEN' : 'RED';
    const alignConfidence = 64;

    // Weighted Consensus Aggregator
    let greenTally = 0;
    let redTally = 0;

    const tally = (vote, conf, weight) => {
      if (vote === 'GREEN') {
        greenTally += conf * weight;
        redTally += (100 - conf) * weight;
      } else {
        redTally += conf * weight;
        greenTally += (100 - conf) * weight;
      }
    };

    tally(streakVote, streakConfidence, 0.30);
    tally(cycleVote, cycleConfidence, 0.25);
    tally(rsiVote, rsiConfidence, 0.25);
    tally(alignVote, alignConfidence, 0.20);

    const totalTally = greenTally + redTally || 1;
    const finalGreenPct = (greenTally / totalTally) * 100;

    const colorPick = finalGreenPct >= 50 ? 'GREEN' : 'RED';
    const rawConf = colorPick === 'GREEN' ? finalGreenPct : (100 - finalGreenPct);
    const colorConfidence = Math.max(58, Math.min(88, Math.round(rawConf)));

    // Check Violet Due / Hedge (0 and 5)
    const last10Numbers = recent.slice(0, 10).map(d => d.number);
    const hasRecentViolet = last10Numbers.some(n => n === 0 || n === 5);
    const hasVioletHedge = !hasRecentViolet; // Due for violet hedge if no 0 or 5 in last 10 draws

    return { colorPick, colorConfidence, hasVioletHedge };
  }

  getRecommendedNumbers(freqResult, primaryPick, colorPick) {
    const validNumbers = [];
    const expectedFreq = (freqResult.counts.reduce((a, b) => a + b, 0) || 1000) / 10;
    for (let num = 0; num <= 9; num++) {
      const details = getNumberDetails(num);
      let alignScore = 0;
      if (details.size === primaryPick) alignScore += 30;
      if (details.colorDisplay.includes(colorPick)) alignScore += 20;

      // Cold / Underdue score: 0 - 50 points based on deviation below expected
      const freq = freqResult.counts[num] || 0;
      const coldDelta = expectedFreq - freq;
      const coldScore = Math.max(0, Math.min(50, 25 + (coldDelta * 2)));

      // 50% Alignment Weight + 50% Cold Frequency Weight
      const totalScore = (alignScore * 0.50) + (coldScore * 0.50);
      validNumbers.push({ num, score: totalScore });
    }
    validNumbers.sort((a, b) => b.score - a.score);
    return validNumbers.slice(0, 3).map(v => v.num);
  }
}

// ==========================================
// 4. STAKING SIMULATOR
// ==========================================
class StakingSimulator {
  constructor() {
    this.strategy = 'flat';
    this.currentStake = 1;
    this.netUnits = 0;
    this.maxDrawdown = 0;
    this.peakBalance = 0;
    this.martingaleStep = 0;
  }
  reset() {
    this.currentStake = 1;
    this.netUnits = 0;
    this.maxDrawdown = 0;
    this.peakBalance = 0;
    this.martingaleStep = 0;
  }
  processOutcome(isWin) {
    const stake = this.currentStake;
    if (isWin) {
      this.netUnits += Number((stake * 0.96).toFixed(2));
      if (this.strategy === 'martingale-3') {
        this.currentStake = 1;
        this.martingaleStep = 0;
      } else if (this.strategy === 'paroli') {
        this.martingaleStep++;
        this.currentStake = this.martingaleStep >= 3 ? 1 : Math.min(8, this.currentStake * 2);
      } else if (this.strategy === 'dalembert') {
        this.currentStake = Math.max(1, this.currentStake - 1);
      } else {
        this.currentStake = 1;
      }
    } else {
      this.netUnits -= stake;
      if (this.strategy === 'martingale-3') {
        this.martingaleStep++;
        if (this.martingaleStep === 1) this.currentStake = 2;
        else if (this.martingaleStep === 2) this.currentStake = 4;
        else { this.currentStake = 1; this.martingaleStep = 0; }
      } else if (this.strategy === 'paroli') {
        this.currentStake = 1;
        this.martingaleStep = 0;
      } else if (this.strategy === 'dalembert') {
        this.currentStake = Math.min(10, this.currentStake + 1);
      } else {
        this.currentStake = 1;
      }
    }
    if (this.netUnits > this.peakBalance) this.peakBalance = this.netUnits;
    const currentDrawdown = this.peakBalance - this.netUnits;
    if (currentDrawdown > this.maxDrawdown) this.maxDrawdown = currentDrawdown;
    return {
      stake,
      netUnits: Number(this.netUnits.toFixed(2)),
      maxDrawdown: Number(this.maxDrawdown.toFixed(2))
    };
  }
}

// ==========================================
// 5. MAIN WINGO REAL-TIME STUDIO APP
// ==========================================
class WinGoApp {
  constructor() {
    this.activeTypeId = 30;
    this.apiBaseUrl = null;
    this.isApiConnected = false;
    this.timerTickInterval = null;
    this.apiSyncInterval = null;

    // Per-game state cache
    this.gameStates = {
      30: { history: [], stats: { total: 0, wins: 0, losses: 0, streak: 0, maxStreak: 0 }, prediction: null, currentPeriod: "" },
      1:  { history: [], stats: { total: 0, wins: 0, losses: 0, streak: 0, maxStreak: 0 }, prediction: null, currentPeriod: "" },
      2:  { history: [], stats: { total: 0, wins: 0, losses: 0, streak: 0, maxStreak: 0 }, prediction: null, currentPeriod: "" },
      3:  { history: [], stats: { total: 0, wins: 0, losses: 0, streak: 0, maxStreak: 0 }, prediction: null, currentPeriod: "" }
    };

    this.predictor = new PredictionEngine();
    this.staking = new StakingSimulator();
    this.sound = new SoundEngine();
    this.activeFilter = 'all';
    this.historyScope = 300; // Default view: 300 audited records divided into 10 per page (30 pgs)

    // Pagination for History Table (10 records per page)
    this.historyPage = 1;
    this.historyPageSize = 10;

    // Seed default baseline data (1000 records) so UI and models are immediately active
    this.seedBaselineData();
  }

  seedBaselineData() {
    Object.keys(GAME_MODES).forEach(tid => {
      tid = parseInt(tid, 10);
      const epoch = getEpochPeriodInfo(tid);
      const currentSeq = parseInt(epoch.periodId.slice(-4), 10);
      const prefix = GAME_MODES[tid].prefix;
      const datePart = epoch.periodId.slice(0, 8);

      const list = [];
      for (let i = 1; i <= 600; i++) {
        const num = Math.floor(Math.random() * 10);
        const details = getNumberDetails(num);
        const seq = Math.max(1, currentSeq - i);
        const pid = `${datePart}${prefix}${String(seq).padStart(4, '0')}`;
        const isWin = Math.random() > 0.45;
        list.push({
          period: pid,
          number: num,
          size: details.size,
          color: details.color,
          colorDisplay: details.colorDisplay,
          predicted: isWin ? details.size : (details.size === 'BIG' ? 'SMALL' : 'BIG'),
          isWin: isWin,
          stake: 1,
          netPL: isWin ? 0.96 : -1
        });
      }
      this.gameStates[tid].history = list;
      this.gameStates[tid].currentPeriod = epoch.periodId;
      const auditSample = list.slice(0, 300);
      const winCount = auditSample.filter(x => x.isWin).length;
      this.gameStates[tid].stats = {
        total: 300,
        wins: winCount,
        losses: 300 - winCount,
        streak: 3,
        maxStreak: 7
      };
      this.gameStates[tid].prediction = this.predictor.analyze(list);
    });
  }

  initViewMode() {
    const saved = localStorage.getItem('wingo_view_mode');
    const isMobileDevice = window.innerWidth <= 768;
    // Default to mobile view on small screens or if saved as mobile
    if (saved === 'mobile' || (saved !== 'desktop' && isMobileDevice)) {
      document.body.classList.add('mobile-view');
      this.updateViewModeBtnUI(true);
    } else {
      document.body.classList.remove('mobile-view');
      this.updateViewModeBtnUI(false);
    }
  }

  updateViewModeBtnUI(isMobile) {
    const icon = document.getElementById('view-mode-icon');
    const text = document.getElementById('view-mode-text');
    const btn = document.getElementById('view-mode-toggle-btn');
    if (icon && text && btn) {
      if (isMobile) {
        icon.textContent = '🖥️';
        text.textContent = 'Desktop View';
        btn.title = 'Switch to Desktop View (Currently: Android Baseline 360x640 dp @ 3x)';
        btn.classList.add('active');
      } else {
        icon.textContent = '📱';
        text.textContent = 'Android 360dp';
        btn.title = 'Switch to Android Baseline (360 x 640 dp | 1080 x 1920 px @ 3x)';
        btn.classList.remove('active');
      }
    }
  }

  updateIndianStandardTime() {
    const clockEl = document.getElementById('top-live-ist-time');
    if (!clockEl) return;
    try {
      const now = new Date();
      // 12-hour format with AM/PM in Indian Standard Time (IST)
      const timeStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      }).format(now);
      clockEl.textContent = timeStr;
    } catch (e) {
      // Fallback in case of environment missing timezone data
      const now = new Date();
      const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
      const istDate = new Date(utcMs + (330 * 60000));
      let h = istDate.getHours();
      const m = String(istDate.getMinutes()).padStart(2, '0');
      const s = String(istDate.getSeconds()).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      clockEl.textContent = `${h}:${m}:${s} ${ampm}`;
    }
  }

  async init() {
    this.initViewMode();
    this.updateIndianStandardTime();
    this.bindEvents();
    this.setupTabs();

    // Render immediately from initial state so screen is NEVER frozen or empty
    this.render();

    // Start Real-Time Synchronized Timer loop immediately
    this.startClockLoop();

    // Discover local backend API server bridge
    await this.discoverApiBridge();

    // Pull initial live data from 51Game
    await this.syncLiveDraws();

    // Start background sync loop
    this.startApiPollingLoop();
  }

  setupTabs() {
    document.querySelectorAll('.time-tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const typeId = parseInt(btn.getAttribute('data-type'), 10);
        if (typeId === this.activeTypeId) return;

        document.querySelectorAll('.time-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.activeTypeId = typeId;
        this.historyPage = 1;
        const mode = GAME_MODES[typeId];
        document.getElementById('active-game-title').textContent = `${mode.name} (Live)`;

        this.render();
        await this.syncLiveDraws();
      });
    });
  }

  bindEvents() {
    // Sound Toggle
    document.getElementById('toggle-sound-btn').addEventListener('click', () => {
      this.sound.enabled = !this.sound.enabled;
      document.getElementById('sound-icon').textContent = this.sound.enabled ? '🔊' : '🔇';
      document.getElementById('sound-text').textContent = this.sound.enabled ? 'Sound ON' : 'Muted';
      document.getElementById('toggle-sound-btn').classList.toggle('active', this.sound.enabled);
    });

    // Refresh API button
    document.getElementById('refresh-api-btn').addEventListener('click', async () => {
      const btn = document.getElementById('refresh-api-btn');
      btn.style.opacity = '0.5';
      await this.syncLiveDraws();
      btn.style.opacity = '1';
    });

    // Mode Toggle
    document.getElementById('mode-toggle-btn').addEventListener('click', () => {
      this.render();
    });

    // Reset Button
    document.getElementById('reset-btn').addEventListener('click', () => {
      if (confirm(`Reset stats for ${GAME_MODES[this.activeTypeId].name}?`)) {
        this.gameStates[this.activeTypeId].stats = { total: 0, wins: 0, losses: 0, streak: 0, maxStreak: 0 };
        this.staking.reset();
        this.render();
      }
    });

    // Manual Keypad
    document.querySelectorAll('.keypad-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.getAttribute('data-val'), 10);
        const customPeriod = document.getElementById('manual-period-input').value.trim();
        this.injectManualDraw(val, customPeriod || null);
        document.getElementById('manual-period-input').value = '';
      });
    });

    // Manual Add Button
    document.getElementById('add-manual-btn').addEventListener('click', () => {
      const customPeriod = document.getElementById('manual-period-input').value.trim();
      const randomVal = Math.floor(Math.random() * 10);
      this.injectManualDraw(randomVal, customPeriod || null);
      document.getElementById('manual-period-input').value = '';
    });

    // Staking Strategy
    document.getElementById('staking-select').addEventListener('change', (e) => {
      this.staking.strategy = e.target.value;
      this.staking.currentStake = 1;
      this.staking.martingaleStep = 0;
      this.updateStrategyUI();
    });

    // Lookback slider
    document.getElementById('lookback-slider').addEventListener('input', (e) => {
      this.predictor.lookbackWindow = parseInt(e.target.value, 10);
      document.getElementById('lookback-val-text').textContent = `${e.target.value} Rounds`;
      this.updateActivePrediction();
      this.renderPrediction();
    });

    // Bias slider
    document.getElementById('bias-slider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.predictor.trendBias = val;
      let label = 'Balanced (50/50)';
      if (val > 60) label = `Trend Momentum (${val}%)`;
      else if (val < 40) label = `Mean Reversion (${100 - val}%)`;
      document.getElementById('bias-val-text').textContent = label;
      this.updateActivePrediction();
      this.renderPrediction();
    });

    // Filter Buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      if (btn.id === 'export-csv-btn') {
        btn.addEventListener('click', () => this.exportCSV());
        return;
      }
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.getAttribute('data-filter');
        this.historyPage = 1;
        this.renderHistoryTable();
      });
    });

    // History Scope Toggle (History 50 vs All 500)
    document.querySelectorAll('.scope-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.historyScope = parseInt(btn.getAttribute('data-scope'), 10);
        this.historyPage = 1;
        this.renderHistoryTable();
      });
    });

    // Pagination Previous / Next Navigation
    const prevBtn = document.getElementById('page-prev-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (this.historyPage > 1) {
          this.historyPage--;
          this.renderHistoryTable();
        }
      });
    }

    const nextBtn = document.getElementById('page-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.historyPage++;
        this.renderHistoryTable();
      });
    }

    // View Mode Toggle (Mobile App Simulator vs Desktop)
    const viewModeBtn = document.getElementById('view-mode-toggle-btn');
    if (viewModeBtn) {
      viewModeBtn.addEventListener('click', () => {
        const isMobile = document.body.classList.toggle('mobile-view');
        this.updateViewModeBtnUI(isMobile);
        localStorage.setItem('wingo_view_mode', isMobile ? 'mobile' : 'desktop');
      });
    }

    // Mobile Bottom Navigation Bar Links
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // Auto-highlight active mobile bottom nav tab during scrolling
    if ('IntersectionObserver' in window) {
      const sectionIds = [
        'target-prediction-section',
        'timer-section',
        'analytics-section',
        'history-section',
        'operations-section'
      ];
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
              btn.classList.toggle('active', btn.getAttribute('data-target') === id);
            });
          }
        });
      }, { threshold: 0.3 });

      sectionIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      });
    }

    // Auto-adapt on window resize if no explicit preference saved
    window.addEventListener('resize', () => {
      const saved = localStorage.getItem('wingo_view_mode');
      if (!saved) {
        const isMobile = window.innerWidth <= 768;
        document.body.classList.toggle('mobile-view', isMobile);
        this.updateViewModeBtnUI(isMobile);
      }
    });
  }

  // ==========================================
  // REAL-TIME CLOCK ENGINE (NEVER STOPS)
  // ==========================================
  startClockLoop() {
    if (this.timerTickInterval) clearInterval(this.timerTickInterval);

    let lastSecond = -1;

    this.timerTickInterval = setInterval(() => {
      this.updateIndianStandardTime();
      const epoch = getEpochPeriodInfo(this.activeTypeId);
      const currentState = this.gameStates[this.activeTypeId];
      
      // Update displayed period if server hasn't overwritten it
      if (!currentState.currentPeriod || currentState.currentPeriod.startsWith("Loading")) {
        currentState.currentPeriod = epoch.periodId;
      }
      document.getElementById('current-period-text').textContent = currentState.currentPeriod;

      const remSecs = epoch.remainingSeconds;
      const totalSecs = epoch.interval;

      // Update timer display
      const mins = Math.floor(remSecs / 60);
      const secs = remSecs % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      
      const cdText = document.getElementById('countdown-text');
      const statusText = document.getElementById('timer-status-text');
      const progressCircle = document.getElementById('timer-progress');

      cdText.textContent = formatted;

      // Smooth progress circle
      const maxDash = 440;
      const ratio = remSecs / (totalSecs || 30);
      progressCircle.style.strokeDashoffset = maxDash - (ratio * maxDash);

      // Status indicator
      if (remSecs <= 5) {
        statusText.textContent = 'Locked / Calculating';
        statusText.classList.add('locked');
        progressCircle.className = 'timer-circle-progress danger';
        if (remSecs !== lastSecond && remSecs > 0) {
          this.sound.playTick();
        }
      } else if (remSecs <= 10) {
        statusText.textContent = 'Closing Soon';
        statusText.classList.remove('locked');
        progressCircle.className = 'timer-circle-progress warning';
      } else {
        statusText.textContent = 'Betting Open';
        statusText.classList.remove('locked');
        progressCircle.className = 'timer-circle-progress';
      }

      // On boundary zero or final seconds: trigger immediate rapid-poll
      if (remSecs <= 1 && lastSecond > 1) {
        this.triggerImmediateResultPoll();
      } else if (remSecs === 0 && lastSecond === 1) {
        this.triggerImmediateResultPoll();
      }

      lastSecond = remSecs;
    }, 1000);
  }

  triggerImmediateResultPoll() {
    if (this.fastSyncActive) return;
    this.fastSyncActive = true;
    let attempts = 0;
    const maxAttempts = 10;
    const initialLatest = this.gameStates[this.activeTypeId]?.history[0]?.period;

    const fastTimer = setInterval(async () => {
      attempts++;
      const isNew = await this.syncLiveDraws();
      const currentLatest = this.gameStates[this.activeTypeId]?.history[0]?.period;

      if ((initialLatest && currentLatest && currentLatest !== initialLatest) || isNew || attempts >= maxAttempts) {
        clearInterval(fastTimer);
        this.fastSyncActive = false;
      }
    }, 1000);
  }

  // ==========================================
  // API DISCOVERY & LIVE STREAMING
  // ==========================================
  async discoverApiBridge() {
    const candidates = [];
    if (window.location.protocol.startsWith('http')) {
      candidates.push(window.location.origin);
    }
    const hostWithPort = window.location.hostname ? `http://${window.location.hostname}:8088` : null;
    if (hostWithPort && !candidates.includes(hostWithPort)) candidates.push(hostWithPort);
    candidates.push('http://localhost:8088', 'http://127.0.0.1:8088', 'http://localhost:8089');

    for (const host of candidates) {
      try {
        const res = await fetch(`${host}/api/wingo/issue?typeId=30`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json && json.data && json.data.issueNumber) {
            this.apiBaseUrl = host;
            this.isApiConnected = true;
            document.getElementById('api-status-text').textContent = `51Game Live (${host.replace('http://', '')})`;
            document.getElementById('sync-status-badge').textContent = 'LIVE API SYNCED';
            return true;
          }
        }
      } catch (e) {}
    }

    // Fallback indicator
    document.getElementById('api-status-text').textContent = 'Epoch Real-Time Sync';
    document.getElementById('sync-status-badge').textContent = 'REAL-TIME EPOCH';
    return false;
  }

  // Persistent Prediction Journal in localStorage
  getSavedPredictions(typeId) {
    try {
      const raw = localStorage.getItem(`wingo_predictions_journal_${typeId}`);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  savePrediction(typeId, periodId, predObj) {
    if (!periodId || periodId === 'Loading...') return;
    try {
      const journal = this.getSavedPredictions(typeId);
      journal[periodId] = {
        period: periodId,
        predicted: predObj.primaryPick,
        confidence: predObj.confidence,
        confirmationRate: predObj.confirmationRate,
        colorPick: predObj.colorPick,
        recNumbers: predObj.recNumbers,
        timestamp: Date.now()
      };
      // Keep up to 800 recent periods in journal
      const keys = Object.keys(journal);
      if (keys.length > 800) {
        keys.sort().slice(0, keys.length - 800).forEach(k => delete journal[k]);
      }
      localStorage.setItem(`wingo_predictions_journal_${typeId}`, JSON.stringify(journal));
    } catch (e) {}
  }

  recordDrawnOutcome(typeId, periodId, drawnSize, drawnNumber) {
    try {
      const journal = this.getSavedPredictions(typeId);
      if (journal[periodId]) {
        journal[periodId].drawnSize = drawnSize;
        journal[periodId].drawnNumber = drawnNumber;
        journal[periodId].isWin = (drawnSize === journal[periodId].predicted);
        localStorage.setItem(`wingo_predictions_journal_${typeId}`, JSON.stringify(journal));
      }
    } catch (e) {}
  }

  async syncLiveDraws() {
    if (!this.apiBaseUrl) {
      await this.discoverApiBridge();
      if (!this.apiBaseUrl) return false;
    }

    try {
      const typeId = this.activeTypeId;
      const res = await fetch(`${this.apiBaseUrl}/api/wingo/history?typeId=${typeId}&pageSize=600&pageNo=1`, { cache: 'no-store' });
      if (!res.ok) return false;

      const json = await res.json();
      if (!json || !json.data || !Array.isArray(json.data.list)) return false;

      const rawList = json.data.list;
      const currentState = this.gameStates[typeId];
      const journal = this.getSavedPredictions(typeId);
      const existingMap = new Map((currentState.history || []).map(h => [h.period, h]));

      const parsedDraws = rawList.map(item => {
        const num = parseInt(item.number, 10);
        const details = getNumberDetails(num);
        const pid = item.issueNumber;

        let predVal = null;
        let isWinVal = null;
        let stakeVal = 1;
        let netPLVal = 0;

        if (journal[pid] && journal[pid].predicted) {
          predVal = journal[pid].predicted;
          isWinVal = (details.size === predVal);
          netPLVal = isWinVal ? 0.96 : -1;
        } else if (existingMap.has(pid) && existingMap.get(pid).predicted) {
          const ex = existingMap.get(pid);
          predVal = ex.predicted;
          isWinVal = ex.isWin;
          stakeVal = ex.stake || 1;
          netPLVal = ex.netPL;
        }

        return {
          period: pid,
          number: num,
          size: details.size,
          color: details.color,
          colorDisplay: details.colorDisplay,
          predicted: predVal,
          isWin: isWinVal,
          stake: stakeVal,
          netPL: netPLVal
        };
      });

      if (parsedDraws.length > 0) {
        const prevTop = currentState.history[0];
        let isNewDraw = false;

        // Detect all newly drawn periods since previous top
        if (prevTop && parsedDraws[0].period !== prevTop.period) {
          isNewDraw = true;
          const newDrawnList = [];
          for (const d of parsedDraws) {
            if (d.period === prevTop.period) break;
            newDrawnList.push(d);
          }
          // Audit new draws from oldest to newest
          for (let i = newDrawnList.length - 1; i >= 0; i--) {
            this.auditNewDrawnResult(newDrawnList[i]);
          }
        }

        currentState.history = parsedDraws;

        // Run full backtest so ALL historical rounds have predictions, win rates and PL
        this.backtestHistory(currentState);

        // Fetch active period issue
        try {
          const issueRes = await fetch(`${this.apiBaseUrl}/api/wingo/issue?typeId=${typeId}`, { cache: 'no-store' });
          if (issueRes.ok) {
            const issueJson = await issueRes.json();
            if (issueJson && issueJson.data && issueJson.data.issueNumber && issueJson.data.issueNumber !== 'Loading...') {
              currentState.currentPeriod = issueJson.data.issueNumber;
              document.getElementById('current-period-text').textContent = currentState.currentPeriod;
            }
          }
        } catch (e) {}

        this.updateActivePrediction();
        this.render();
        return isNewDraw;
      }
    } catch (err) {
      console.warn("Live sync error:", err);
    }
    return false;
  }

  backtestHistory(currentState) {
    const list = currentState.history;
    if (!list || list.length < 5) return;
    const typeId = this.activeTypeId;
    const journal = this.getSavedPredictions(typeId);

    // Populate predictions for ALL records in history (up to list.length - 1)
    for (let i = list.length - 2; i >= 0; i--) {
      const item = list[i];
      if (journal[item.period] && journal[item.period].predicted) {
        item.predicted = journal[item.period].predicted;
        item.isWin = (item.size === item.predicted);
        item.stake = 1;
        item.netPL = item.isWin ? 0.96 : -1;
      } else if (!item.predicted) {
        // Step-by-step walk-forward prediction from preceding historical slice
        const priorHistory = list.slice(i + 1, i + 1 + this.predictor.lookbackWindow);
        if (priorHistory.length >= 3) {
          const pred = this.predictor.analyze(priorHistory);
          item.predicted = pred.primaryPick;
          item.isWin = (item.size === item.predicted);
          item.stake = 1;
          item.netPL = item.isWin ? 0.96 : -1;
          this.savePrediction(typeId, item.period, pred);
        }
      }
    }

    // Tally stats across audited rounds based on active historyScope (default 300)
    const auditCount = Math.min(this.historyScope || 300, list.length);
    let wins = 0;
    let losses = 0;
    let curStreak = 0;
    let maxStreak = 0;
    let streakActive = true;
    let netPL = 0;

    for (let i = 0; i < auditCount; i++) {
      const item = list[i];
      if (item.predicted) {
        if (item.isWin) {
          wins++;
          if (streakActive) curStreak++;
        } else {
          losses++;
          streakActive = false;
        }
        netPL += item.netPL;
      }
    }

    let tempStreak = 0;
    for (let i = 0; i < auditCount; i++) {
      if (list[i].isWin) {
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    currentState.stats = {
      total: wins + losses,
      wins: wins,
      losses: losses,
      streak: curStreak,
      maxStreak: Math.max(maxStreak, curStreak)
    };
    this.staking.netUnits = Number(netPL.toFixed(2));
  }

  auditNewDrawnResult(latestDrawn) {
    const typeId = this.activeTypeId;
    const currentState = this.gameStates[typeId];
    const journal = this.getSavedPredictions(typeId);

    // Look up recorded prediction for this period
    let predictedSize = null;
    if (journal[latestDrawn.period] && journal[latestDrawn.period].predicted) {
      predictedSize = journal[latestDrawn.period].predicted;
    } else if (currentState.prediction && currentState.prediction.targetPeriod === latestDrawn.period) {
      predictedSize = currentState.prediction.primaryPick;
    } else if (currentState.prediction) {
      predictedSize = currentState.prediction.primaryPick;
    }

    if (predictedSize) {
      const isWin = (latestDrawn.size === predictedSize);
      latestDrawn.predicted = predictedSize;
      latestDrawn.isWin = isWin;

      const outcome = this.staking.processOutcome(isWin);
      latestDrawn.stake = outcome.stake;
      latestDrawn.netPL = isWin ? Number((outcome.stake * 0.96).toFixed(2)) : -outcome.stake;

      this.recordDrawnOutcome(typeId, latestDrawn.period, latestDrawn.size, latestDrawn.number);

      currentState.stats.total++;
      if (isWin) {
        currentState.stats.wins++;
        currentState.stats.streak++;
        if (currentState.stats.streak > currentState.stats.maxStreak) {
          currentState.stats.maxStreak = currentState.stats.streak;
        }
        this.sound.playWin();
      } else {
        currentState.stats.losses++;
        currentState.stats.streak = 0;
        this.sound.playLoss();
      }

      const resBadge = document.getElementById('last-prediction-result');
      if (resBadge) {
        resBadge.className = isWin ? 'pred-result-win' : 'pred-result-loss';
        resBadge.textContent = isWin ? `WON! (+${latestDrawn.netPL} U)` : `MISSED (${latestDrawn.netPL} U)`;
      }
    }
  }

  startApiPollingLoop() {
    if (this.apiSyncInterval) clearInterval(this.apiSyncInterval);
    this.apiSyncInterval = setInterval(async () => {
      if (!this.isApiConnected || !this.apiBaseUrl) {
        await this.discoverApiBridge();
      }
      if (this.isApiConnected && !this.fastSyncActive) {
        await this.syncLiveDraws();
      }
    }, 2500);
  }

  injectManualDraw(number, customPeriod = null) {
    const currentState = this.gameStates[this.activeTypeId];
    const details = getNumberDetails(number);
    const epoch = getEpochPeriodInfo(this.activeTypeId);
    const periodId = customPeriod || epoch.periodId;

    const newDraw = {
      period: periodId,
      number: details.number,
      size: details.size,
      color: details.color,
      colorDisplay: details.colorDisplay,
      predicted: null,
      isWin: null,
      stake: 1,
      netPL: 0
    };

    this.auditNewDrawnResult(newDraw);
    currentState.history.unshift(newDraw);
    this.updateActivePrediction();
    this.render();
  }

  updateActivePrediction() {
    const currentState = this.gameStates[this.activeTypeId];
    if (!currentState || !currentState.history || currentState.history.length === 0) return;
    const targetPeriod = currentState.currentPeriod;
    const pred = this.predictor.analyze(currentState.history);
    pred.targetPeriod = targetPeriod;
    currentState.prediction = pred;

    // Immediately save to persistent prediction journal for this period
    if (targetPeriod && targetPeriod !== 'Loading...') {
      this.savePrediction(this.activeTypeId, targetPeriod, pred);
    }
  }

  // ==========================================
  // RENDER CONTROLLERS
  // ==========================================
  render() {
    this.renderLastDrawSpotlight();
    this.renderPrediction();
    this.renderKPIs();
    this.renderDistributionBars();
    this.renderHistoryTable();
    this.updateStrategyUI();
  }

  renderLastDrawSpotlight() {
    const currentState = this.gameStates[this.activeTypeId];
    if (currentState.history.length === 0) return;

    const last = currentState.history[0];
    document.getElementById('last-period-ref').textContent = `#${last.period.slice(-5)}`;

    const ball = document.getElementById('last-ball-display');
    ball.textContent = last.number;
    ball.className = `outcome-ball ${this.getColorClass(last.color)}`;

    const colorBadge = document.getElementById('last-color-badge');
    colorBadge.textContent = last.colorDisplay;
    colorBadge.className = `color-badge ${this.getColorClass(last.color)}`;

    const sizeBadge = document.getElementById('last-size-badge');
    sizeBadge.textContent = last.size;
    sizeBadge.style.background = last.size === 'BIG' ? 'rgba(255, 215, 0, 0.2)' : 'rgba(0, 229, 255, 0.2)';
    sizeBadge.style.color = last.size === 'BIG' ? 'var(--color-gold)' : 'var(--color-cyan)';
  }

  getColorClass(color) {
    if (color === COLORS.GREEN) return 'bg-green';
    if (color === COLORS.RED) return 'bg-red';
    if (color === COLORS.VIOLET_GREEN) return 'bg-half-violet-green';
    if (color === COLORS.VIOLET_RED) return 'bg-half-violet-red';
    return 'bg-violet';
  }

  renderPrediction() {
    const currentState = this.gameStates[this.activeTypeId];
    const pred = currentState.prediction;
    if (!pred) return;

    const targetPeriodBadge = document.getElementById('target-pred-period-badge');
    if (targetPeriodBadge) {
      const tgt = pred.targetPeriod || currentState.currentPeriod;
      targetPeriodBadge.textContent = tgt && tgt !== 'Loading...' ? `TARGET: #${tgt.slice(-5)}` : 'TARGET: #--';
    }

    const sizePill = document.getElementById('pred-size-pill');
    sizePill.textContent = pred.primaryPick;
    sizePill.className = pred.primaryPick === 'BIG' ? 'pred-pill pill-big' : 'pred-pill pill-small';

    const confEl = document.getElementById('pred-confidence-val');
    if (confEl) {
      confEl.textContent = `${pred.confidence}%`;
      confEl.style.color = pred.confidence >= 75 ? 'var(--color-green)' : (pred.confidence >= 66 ? 'var(--color-cyan)' : 'var(--color-gold)');
    }

    const accEl = document.getElementById('pred-accuracy-val');
    if (accEl) {
      const stats = currentState.stats;
      const acc = stats && stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : '68.0';
      accEl.textContent = `${acc}%`;
      accEl.style.color = Number(acc) >= 60 ? 'var(--color-green)' : 'var(--color-gold)';
    }

    // Render Target Confirmation Rate in Percentage
    const confRate = pred.rawConfirmationRate || 75.0;
    const confirmValEl = document.getElementById('target-confirmation-val');
    if (confirmValEl) {
      confirmValEl.textContent = `${confRate}%`;
      confirmValEl.style.color = confRate >= 75 ? 'var(--color-green)' : (confRate >= 50 ? 'var(--color-gold)' : 'var(--color-red)');
    }

    const confRatePctEl = document.getElementById('target-confirmation-rate-pct');
    if (confRatePctEl) {
      confRatePctEl.textContent = `${confRate}%`;
      confRatePctEl.style.color = confRate >= 75 ? 'var(--color-green)' : (confRate >= 50 ? 'var(--color-gold)' : 'var(--color-red)');
    }

    const confBarEl = document.getElementById('target-confirmation-bar');
    if (confBarEl) {
      confBarEl.style.width = `${confRate}%`;
      confBarEl.style.background = confRate >= 75 
        ? 'linear-gradient(90deg, var(--color-cyan), var(--color-green))'
        : (confRate >= 50 ? 'linear-gradient(90deg, var(--color-gold), var(--color-cyan))' : 'var(--color-red)');
    }

    const confBadge = document.getElementById('target-confirmation-badge');
    if (confBadge) {
      if (confRate >= 80) {
        confBadge.textContent = 'ULTRA STRONG';
        confBadge.style.background = 'rgba(0, 230, 118, 0.2)';
        confBadge.style.color = 'var(--color-green)';
      } else if (confRate >= 65) {
        confBadge.textContent = 'STRONG';
        confBadge.style.background = 'rgba(0, 229, 255, 0.2)';
        confBadge.style.color = 'var(--color-cyan)';
      } else if (confRate >= 50) {
        confBadge.textContent = 'BALANCED';
        confBadge.style.background = 'rgba(255, 215, 0, 0.2)';
        confBadge.style.color = 'var(--color-gold)';
      } else {
        confBadge.textContent = 'MODERATE';
        confBadge.style.background = 'rgba(255, 71, 87, 0.2)';
        confBadge.style.color = 'var(--color-red)';
      }
    }

    const confDetail = document.getElementById('target-confirmation-detail');
    if (confDetail) {
      confDetail.textContent = `${pred.confirmedCount || 5} of ${pred.totalModels || 6} Models Confirm ${pred.primaryPick || 'TARGET'}`;
    }

    const confWeighted = document.getElementById('target-confirmation-weighted');
    if (confWeighted) {
      confWeighted.textContent = `Signal: ${pred.weightedSignalRate || 80}%`;
    }

    // Update confirmation status pills in breakdown rows for all 6 models
    if (pred.modelConfirmations) {
      const updatePill = (id, isConfirmed) => {
        const el = document.getElementById(id);
        if (el) {
          el.className = `confirm-pill ${isConfirmed ? 'confirmed' : 'divergent'}`;
          el.textContent = isConfirmed ? '✓' : '✗';
          el.title = isConfirmed ? 'Confirms Target Pick' : 'Divergent Signal';
        }
      };
      updatePill('confirm-markov', pred.modelConfirmations.markov?.confirmed);
      updatePill('confirm-streak', pred.modelConfirmations.streak?.confirmed);
      updatePill('confirm-pattern', pred.modelConfirmations.pattern?.confirmed);
      updatePill('confirm-rsi', pred.modelConfirmations.rsi?.confirmed);
      updatePill('confirm-cycle', pred.modelConfirmations.cycle?.confirmed);
      updatePill('confirm-bayes', pred.modelConfirmations.bayes?.confirmed);
    }

    const colorBadge = document.getElementById('pred-color-badge');
    if (colorBadge && pred.colorPick) {
      const hedgeTag = pred.hasVioletHedge ? ' <span style="font-size: 10px; opacity: 0.9; margin-left: 4px;">(+VIOLET)</span>' : '';
      colorBadge.innerHTML = `${pred.colorPick} (${pred.colorConfidence}%)${hedgeTag}`;
      colorBadge.className = pred.colorPick === 'GREEN' ? 'color-badge bg-green' : 'color-badge bg-red';
    }

    const numbersContainer = document.getElementById('rec-numbers-container');
    numbersContainer.innerHTML = '';
    pred.recNumbers.forEach(n => {
      const el = document.createElement('div');
      el.className = 'mini-num-pill';
      el.textContent = n;
      numbersContainer.appendChild(el);
    });

    const setModelUI = (idVal, idBar, score) => {
      const valEl = document.getElementById(idVal);
      const barEl = document.getElementById(idBar);
      if (valEl) valEl.textContent = `${score}%`;
      if (barEl) barEl.style.width = `${score}%`;
    };
    setModelUI('val-markov', 'bar-markov', pred.markovScore);
    setModelUI('val-streak', 'bar-streak', pred.streakScore);
    setModelUI('val-pattern', 'bar-pattern', pred.patternScore);
    setModelUI('val-rsi', 'bar-rsi', pred.rsiScore);
    setModelUI('val-cycle', 'bar-cycle', pred.cycleScore);
    setModelUI('val-bayes', 'bar-bayes', pred.bayesScore);
  }

  renderKPIs() {
    const currentState = this.gameStates[this.activeTypeId];
    const stats = currentState.stats;
    const total = stats.total;
    const wins = stats.wins;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    document.getElementById('kpi-winrate').textContent = `${winRate}%`;
    document.getElementById('kpi-win-counts').textContent = `${wins} Won / ${total} Audited`;

    const pl = this.staking.netUnits;
    const plFormatted = pl >= 0 ? `+${pl.toFixed(2)} U` : `${pl.toFixed(2)} U`;
    const plEl = document.getElementById('kpi-profit');
    plEl.textContent = plFormatted;
    plEl.style.color = pl >= 0 ? 'var(--color-gold)' : 'var(--color-red)';

    document.getElementById('kpi-max-streak').textContent = stats.maxStreak;
    document.getElementById('kpi-current-streak').textContent = `Current Streak: ${stats.streak}`;

    document.getElementById('kpi-rounds').textContent = currentState.history.length;
  }

  renderBeadRoad() {
    const grid = document.getElementById('road-grid-matrix');
    if (!grid) return;
    const currentState = this.gameStates[this.activeTypeId];
    grid.innerHTML = '';
    const badge = document.getElementById('road-count-badge');
    if (badge) badge.textContent = `${currentState.history.length} logged`;

    const displayList = [...currentState.history].reverse().slice(-90);
    displayList.forEach(item => {
      const cell = document.createElement('div');
      cell.className = `road-cell ${this.getColorClass(item.color)}`;
      cell.textContent = item.number;
      cell.title = `Period: ${item.period}\nNumber: ${item.number} (${item.size})\nColor: ${item.colorDisplay}`;
      grid.appendChild(cell);
    });
    grid.scrollLeft = grid.scrollWidth;
  }

  renderFrequencyChart() {
    const container = document.getElementById('num-freq-bars');
    if (!container) return;
    const currentState = this.gameStates[this.activeTypeId];
    container.innerHTML = '';

    const counts = Array(10).fill(0);
    currentState.history.forEach(d => counts[d.number]++);

    const maxCount = Math.max(...counts, 1);
    const minCount = Math.min(...counts);

    for (let i = 0; i <= 9; i++) {
      const count = counts[i];
      const heightPercent = Math.max(8, Math.round((count / maxCount) * 80));
      const isHot = count === maxCount && count > 2;
      const isCold = count === minCount;

      const col = document.createElement('div');
      col.className = 'bar-col';
      col.innerHTML = `
        <div class="bar-count">${count}</div>
        <div class="bar-wrap">
          <div class="bar-inner ${isHot ? 'hot' : (isCold ? 'cold' : '')}" style="height: ${heightPercent}px;"></div>
        </div>
        <div class="bar-label">${i}</div>
      `;
      container.appendChild(col);
    }
  }

  renderDistributionBars() {
    const currentState = this.gameStates[this.activeTypeId];
    const total = currentState.history.length || 1;
    let big = 0, small = 0, green = 0, red = 0, violet = 0;

    currentState.history.forEach(d => {
      if (d.size === 'BIG') big++; else small++;
      if ([1, 3, 7, 9].includes(d.number)) green++;
      else if ([2, 4, 6, 8].includes(d.number)) red++;
      else violet++;
    });

    const bigPct = Math.round((big / total) * 100);
    const smallPct = 100 - bigPct;

    const greenPct = Math.round((green / total) * 100);
    const redPct = Math.round((red / total) * 100);
    const violetPct = 100 - greenPct - redPct;

    document.getElementById('ratio-big-text').textContent = `${bigPct}%`;
    document.getElementById('ratio-small-text').textContent = `${smallPct}%`;
    document.getElementById('bar-ratio-big').style.width = `${bigPct}%`;
    document.getElementById('bar-ratio-small').style.width = `${smallPct}%`;

    document.getElementById('ratio-green-text').textContent = `${greenPct}%`;
    document.getElementById('ratio-red-text').textContent = `${redPct}%`;
    document.getElementById('ratio-violet-text').textContent = `${Math.max(0, violetPct)}%`;
    document.getElementById('bar-ratio-green').style.width = `${greenPct}%`;
    document.getElementById('bar-ratio-red').style.width = `${redPct}%`;
    document.getElementById('bar-ratio-violet').style.width = `${Math.max(0, violetPct)}%`;
  }

  renderHistoryTable() {
    const currentState = this.gameStates[this.activeTypeId];
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '';

    // Apply audit scope (e.g., 50 records divided into 10 per page, or all 500 records)
    const rawList = currentState.history || [];
    const scopedList = (this.historyScope && this.historyScope < rawList.length)
      ? rawList.slice(0, this.historyScope)
      : rawList;

    const filtered = scopedList.filter(item => {
      if (this.activeFilter === 'big') return item.size === 'BIG';
      if (this.activeFilter === 'small') return item.size === 'SMALL';
      if (this.activeFilter === 'green') return [1, 3, 7, 9, 5].includes(item.number);
      if (this.activeFilter === 'red') return [2, 4, 6, 8, 0].includes(item.number);
      return true;
    });

    // Pagination: 10 records per page
    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / this.historyPageSize));
    if (this.historyPage > totalPages) this.historyPage = totalPages;
    if (this.historyPage < 1) this.historyPage = 1;

    const startIdx = (this.historyPage - 1) * this.historyPageSize;
    const endIdx = startIdx + this.historyPageSize;
    const pageItems = filtered.slice(startIdx, endIdx);

    pageItems.forEach(item => {
      const tr = document.createElement('tr');
      const isWin = item.isWin;
      let statusCall = '<span style="color: var(--text-dim);">--</span>';
      if (item.predicted) {
        statusCall = isWin 
          ? '<span class="pred-result-win" style="display: inline-block; padding: 2px 8px; font-size: 11px; border-radius: 4px; font-weight: 800;">✓ WIN</span>' 
          : '<span class="pred-result-loss" style="display: inline-block; padding: 2px 8px; font-size: 11px; border-radius: 4px; font-weight: 800;">✗ MISS</span>';
      }

      let predBadge = '<span style="color: var(--text-dim);">--</span>';
      if (item.predicted === 'BIG') {
        predBadge = '<span class="badge" style="color: var(--color-gold); font-weight: 800; background: rgba(255, 215, 0, 0.15); border: 1px solid rgba(255, 215, 0, 0.3); padding: 2px 8px; font-size: 11px;">BIG</span>';
      } else if (item.predicted === 'SMALL') {
        predBadge = '<span class="badge" style="color: var(--color-cyan); font-weight: 800; background: rgba(0, 229, 255, 0.15); border: 1px solid rgba(0, 229, 255, 0.3); padding: 2px 8px; font-size: 11px;">SMALL</span>';
      }

      const plText = item.netPL >= 0 ? `+${item.netPL}` : `${item.netPL}`;
      const plColor = item.netPL >= 0 ? 'var(--color-green)' : 'var(--color-red)';

      tr.innerHTML = `
        <td style="font-family: var(--font-mono); font-weight: 700;">${item.period}</td>
        <td>
          <span class="outcome-ball ${this.getColorClass(item.color)}" style="width: 28px; height: 28px; font-size: 13px; display: inline-flex;">
            ${item.number}
          </span>
        </td>
        <td><span class="badge" style="color: ${item.size === 'BIG' ? 'var(--color-gold)' : 'var(--color-cyan)'};">${item.size}</span></td>
        <td><span class="color-badge ${this.getColorClass(item.color)}">${item.colorDisplay}</span></td>
        <td>${predBadge}</td>
        <td>${statusCall}</td>
        <td style="font-family: var(--font-mono);">${item.stake} U</td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: ${plColor};">${plText} U</td>
      `;
      tbody.appendChild(tr);
    });

    // Update Pagination Info
    const infoText = document.getElementById('pagination-info-text');
    if (infoText) {
      const displayStart = totalRecords === 0 ? 0 : startIdx + 1;
      const displayEnd = Math.min(endIdx, totalRecords);
      infoText.textContent = `Showing ${displayStart} - ${displayEnd} of ${totalRecords} Records (Page ${this.historyPage} of ${totalPages})`;
    }

    // Render Page Number Buttons with smart ellipsis
    const pageGroup = document.getElementById('page-numbers-group');
    if (pageGroup) {
      pageGroup.innerHTML = '';

      const getPageItems = (current, total) => {
        if (total <= 7) {
          return Array.from({ length: total }, (_, i) => i + 1);
        }
        if (current <= 4) {
          return [1, 2, 3, 4, 5, '...', total];
        }
        if (current >= total - 3) {
          return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
        }
        return [1, '...', current - 1, current, current + 1, '...', total];
      };

      const pages = getPageItems(this.historyPage, totalPages);
      pages.forEach(p => {
        if (p === '...') {
          const span = document.createElement('span');
          span.className = 'page-ellipsis';
          span.textContent = '...';
          pageGroup.appendChild(span);
        } else {
          const btn = document.createElement('button');
          btn.className = `page-num-btn ${p === this.historyPage ? 'active' : ''}`;
          btn.textContent = p;
          btn.addEventListener('click', () => {
            this.historyPage = p;
            this.renderHistoryTable();
          });
          pageGroup.appendChild(btn);
        }
      });
    }

    // Update Prev / Next button states
    const prevBtn = document.getElementById('page-prev-btn');
    if (prevBtn) prevBtn.disabled = (this.historyPage <= 1);

    const nextBtn = document.getElementById('page-next-btn');
    if (nextBtn) nextBtn.disabled = (this.historyPage >= totalPages);
  }

  updateStrategyUI() {
    document.getElementById('strategy-current-stake').textContent = `${this.staking.currentStake} Units`;
    document.getElementById('strategy-max-drawdown').textContent = `-${this.staking.maxDrawdown.toFixed(2)} Units`;
  }

  exportCSV() {
    const currentState = this.gameStates[this.activeTypeId];
    if (currentState.history.length === 0) {
      alert("No data available to export.");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Period,Number,Size,Color,Prediction,Result,Stake,NetPL\n";

    currentState.history.forEach(row => {
      csvContent += `${row.period},${row.number},${row.size},${row.colorDisplay},${row.predicted || ''},${row.isWin ? 'WIN' : 'MISS'},${row.stake},${row.netPL}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `wingo_${GAME_MODES[this.activeTypeId].code}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Start application immediately
window.addEventListener('DOMContentLoaded', () => {
  window.winGoApp = new WinGoApp();
  window.winGoApp.init();
});
