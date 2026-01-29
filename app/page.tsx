"use client";

import { useState, useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

interface MarketData {
  timestamp: number;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  high: number;
  low: number;
}

interface Alert {
  id: string;
  timestamp: number;
  asset: string;
  event: string;
  bias: "bull" | "bear" | "neutral";
  triggerLevel: number;
  invalidationLevel: number;
  probability: number;
  riskNote: string;
}

interface AnalysisState {
  bias: "bull" | "bear" | "neutral";
  regime: "trend" | "range" | "high-volatility";
  keyLevels: { support: number; resistance: number };
  lastStructure: "HH" | "HL" | "LH" | "LL" | null;
  recentHighs: number[];
  recentLows: number[];
  atr: number;
  lastAlertTime: number;
}

export default function Home() {
  const [marketData, setMarketData] = useState<MarketData[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [status, setStatus] = useState<string>("Initializing...");
  const [isActive, setIsActive] = useState(false);

  const stateRef = useRef<AnalysisState>({
    bias: "neutral",
    regime: "range",
    keyLevels: { support: 0, resistance: 0 },
    lastStructure: null,
    recentHighs: [],
    recentLows: [],
    atr: 0,
    lastAlertTime: 0,
  });

  // Simulate live market data fetch
  const fetchMarketData = async (): Promise<MarketData> => {
    // Simulated Binance-like data for BTC/USDT
    const basePrice = 43000 + Math.sin(Date.now() / 10000) * 500;
    const volatility = 50 + Math.random() * 100;
    const price = basePrice + (Math.random() - 0.5) * volatility;
    const spread = price * 0.0001;

    return {
      timestamp: Date.now(),
      price,
      bid: price - spread / 2,
      ask: price + spread / 2,
      volume: Math.random() * 1000 + 500,
      high: price + Math.random() * 20,
      low: price - Math.random() * 20,
    };
  };

  // Calculate ATR (Average True Range)
  const calculateATR = (data: MarketData[], period: number = 14): number => {
    if (data.length < period) return 0;

    const trueRanges = data.slice(-period).map((d, i) => {
      if (i === 0) return d.high - d.low;
      const prevClose = data[data.length - period + i - 1].price;
      return Math.max(
        d.high - d.low,
        Math.abs(d.high - prevClose),
        Math.abs(d.low - prevClose)
      );
    });

    return trueRanges.reduce((sum, tr) => sum + tr, 0) / period;
  };

  // Detect market structure
  const detectStructure = (data: MarketData[], state: AnalysisState): void => {
    if (data.length < 20) return;

    const recent = data.slice(-20);
    const prices = recent.map(d => d.price);

    // Find swing highs and lows
    const highs = [];
    const lows = [];

    for (let i = 2; i < prices.length - 2; i++) {
      if (prices[i] > prices[i - 1] && prices[i] > prices[i - 2] &&
          prices[i] > prices[i + 1] && prices[i] > prices[i + 2]) {
        highs.push(prices[i]);
      }
      if (prices[i] < prices[i - 1] && prices[i] < prices[i - 2] &&
          prices[i] < prices[i + 1] && prices[i] < prices[i + 2]) {
        lows.push(prices[i]);
      }
    }

    state.recentHighs = highs.slice(-3);
    state.recentLows = lows.slice(-3);

    // Determine structure
    if (highs.length >= 2 && highs[highs.length - 1] > highs[highs.length - 2]) {
      state.lastStructure = "HH";
      state.bias = "bull";
    } else if (lows.length >= 2 && lows[lows.length - 1] < lows[lows.length - 2]) {
      state.lastStructure = "LL";
      state.bias = "bear";
    } else if (highs.length >= 2 && highs[highs.length - 1] < highs[highs.length - 2]) {
      state.lastStructure = "LH";
      state.bias = "bear";
    } else if (lows.length >= 2 && lows[lows.length - 1] > lows[lows.length - 2]) {
      state.lastStructure = "HL";
      state.bias = "bull";
    }

    // Set key levels
    if (state.recentLows.length > 0) {
      state.keyLevels.support = Math.min(...state.recentLows);
    }
    if (state.recentHighs.length > 0) {
      state.keyLevels.resistance = Math.max(...state.recentHighs);
    }
  };

  // Detect market regime
  const detectRegime = (data: MarketData[], state: AnalysisState): void => {
    if (data.length < 20) return;

    const recent = data.slice(-20);
    const avgVolatility = calculateATR(data, 14);
    state.atr = avgVolatility;

    const priceRange = Math.max(...recent.map(d => d.price)) - Math.min(...recent.map(d => d.price));
    const avgPrice = recent.reduce((sum, d) => sum + d.price, 0) / recent.length;
    const volatilityRatio = priceRange / avgPrice;

    if (volatilityRatio > 0.015) {
      state.regime = "high-volatility";
    } else if (state.recentHighs.length >= 2 && state.recentLows.length >= 2) {
      const trendStrength = Math.abs(
        (state.recentHighs[state.recentHighs.length - 1] - state.recentHighs[0]) +
        (state.recentLows[state.recentLows.length - 1] - state.recentLows[0])
      );
      state.regime = trendStrength > avgPrice * 0.01 ? "trend" : "range";
    }
  };

  // Analyze and generate alerts
  const analyzeMarket = (data: MarketData[], state: AnalysisState): Alert | null => {
    if (data.length < 30) return null;

    const now = Date.now();
    const timeSinceLastAlert = (now - state.lastAlertTime) / 1000;

    // Cooldown period: 30 seconds minimum between alerts
    if (timeSinceLastAlert < 30) return null;

    const currentData = data[data.length - 1];
    const recent = data.slice(-20);
    const volumeAvg = recent.reduce((sum, d) => sum + d.volume, 0) / recent.length;

    // Breakout detection
    if (state.keyLevels.resistance > 0 &&
        currentData.price > state.keyLevels.resistance &&
        currentData.volume > volumeAvg * 1.5) {

      state.lastAlertTime = now;
      return {
        id: `alert-${now}`,
        timestamp: now,
        asset: "BTC/USDT",
        event: "Breakout above resistance with volume confirmation",
        bias: "bull",
        triggerLevel: state.keyLevels.resistance,
        invalidationLevel: state.keyLevels.resistance - state.atr * 1.5,
        probability: 68,
        riskNote: `Invalidation if price closes below ${(state.keyLevels.resistance - state.atr * 1.5).toFixed(2)}`,
      };
    }

    // Breakdown detection
    if (state.keyLevels.support > 0 &&
        currentData.price < state.keyLevels.support &&
        currentData.volume > volumeAvg * 1.5) {

      state.lastAlertTime = now;
      return {
        id: `alert-${now}`,
        timestamp: now,
        asset: "BTC/USDT",
        event: "Breakdown below support with volume confirmation",
        bias: "bear",
        triggerLevel: state.keyLevels.support,
        invalidationLevel: state.keyLevels.support + state.atr * 1.5,
        probability: 65,
        riskNote: `Invalidation if price reclaims above ${(state.keyLevels.support + state.atr * 1.5).toFixed(2)}`,
      };
    }

    // Volatility spike detection
    const recentATR = calculateATR(data.slice(-5), 5);
    if (state.atr > 0 && recentATR > state.atr * 1.8) {
      state.lastAlertTime = now;
      return {
        id: `alert-${now}`,
        timestamp: now,
        asset: "BTC/USDT",
        event: "Volatility expansion after compression",
        bias: state.bias,
        triggerLevel: currentData.price,
        invalidationLevel: state.bias === "bull"
          ? currentData.price - recentATR * 2
          : currentData.price + recentATR * 2,
        probability: 58,
        riskNote: `Watch for directional move. High volatility suggests potential trend start.`,
      };
    }

    // Liquidity sweep detection
    if (state.recentLows.length >= 2) {
      const prevLow = state.recentLows[state.recentLows.length - 2];
      const wickLow = currentData.low;

      if (wickLow < prevLow && currentData.price > prevLow) {
        state.lastAlertTime = now;
        return {
          id: `alert-${now}`,
          timestamp: now,
          asset: "BTC/USDT",
          event: "Liquidity sweep below previous low with reclaim",
          bias: "bull",
          triggerLevel: prevLow,
          invalidationLevel: wickLow,
          probability: 62,
          riskNote: `Invalidation if price returns below ${wickLow.toFixed(2)}. Possible liquidity grab.`,
        };
      }
    }

    return null;
  };

  // Main analysis cycle (5 seconds)
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(async () => {
      try {
        const newData = await fetchMarketData();

        setMarketData((prev) => {
          const updated = [...prev, newData];
          const limited = updated.slice(-100); // Keep last 100 data points

          const state = stateRef.current;

          // Run analysis pipeline
          detectStructure(limited, state);
          detectRegime(limited, state);
          const alert = analyzeMarket(limited, state);

          if (alert) {
            setAlerts((prevAlerts) => [alert, ...prevAlerts.slice(0, 19)]);
          }

          setCurrentPrice(newData.price);
          setStatus(`Monitoring • ${state.regime.toUpperCase()} • ${state.bias.toUpperCase()} bias`);

          return limited;
        });
      } catch (error) {
        setStatus("Error fetching data");
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isActive]);

  const getBiasIcon = (bias: string) => {
    switch (bias) {
      case "bull": return <TrendingUp className="w-4 h-4 text-green-500" />;
      case "bear": return <TrendingDown className="w-4 h-4 text-red-500" />;
      default: return <Minus className="w-4 h-4 text-gray-500" />;
    }
  };

  const chartData = marketData.slice(-50).map((d) => ({
    time: new Date(d.timestamp).toLocaleTimeString(),
    price: d.price,
  }));

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Crypto Market Analyst</h1>
            <p className="text-gray-400 text-sm mt-1">Autonomous micro-structure analysis • 5s refresh cycle</p>
          </div>
          <button
            onClick={() => setIsActive(!isActive)}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              isActive
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}
          >
            {isActive ? "Stop Analysis" : "Start Analysis"}
          </button>
        </div>

        {/* Status Bar */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isActive ? "bg-green-500 animate-pulse" : "bg-gray-500"}`} />
                <span className="text-sm font-mono">{status}</span>
              </div>
            </div>
            <div className="text-2xl font-bold font-mono">
              ${currentPrice > 0 ? currentPrice.toFixed(2) : "---"}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">BTC/USDT Price Action</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <XAxis
                dataKey="time"
                stroke="#6b7280"
                style={{ fontSize: "12px" }}
              />
              <YAxis
                stroke="#6b7280"
                style={{ fontSize: "12px" }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px"
                }}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Alerts */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <h2 className="text-xl font-semibold">High-Quality Alerts</h2>
          </div>

          {alerts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-sm">No alerts generated yet.</p>
              <p className="text-xs mt-1">Alerts trigger only on high-quality signals.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="bg-gray-800 border border-gray-700 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {getBiasIcon(alert.bias)}
                        <span className="font-semibold">{alert.asset}</span>
                        <span className="text-xs text-gray-500">
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300">{alert.event}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500 uppercase">{alert.bias} bias</div>
                      <div className="text-lg font-bold text-blue-400">{alert.probability}%</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Trigger:</span>
                      <span className="ml-2 font-mono">${alert.triggerLevel.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Invalidation:</span>
                      <span className="ml-2 font-mono">${alert.invalidationLevel.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <p className="text-xs text-gray-400">
                      <span className="font-semibold">Risk:</span> {alert.riskNote}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center text-xs text-gray-500">
          <p>This tool is for analysis only. Not financial advice. Trade at your own risk.</p>
        </div>
      </div>
    </main>
  );
}
