import type {
  CandlesFetchResult,
  ChartResolution,
  HistoryRangeConfig,
  MarketStats,
  MarketTicker,
} from '../types/market';

// Base API paths (Vite dev proxy forwards /api -> http://localhost:8000)
const API_V1_BASE = '/api/v1';
const FALLBACK_V1_BASE = 'http://localhost:8000/api/v1';

async function fetchFromApi<T>(path: string, options: RequestInit = {}, timeoutMs = 25000): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  const reqHeaders = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  // Attempt 1: Proxied /api/v1/...
  try {
    const res = await fetch(`${API_V1_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: reqHeaders,
    });
    clearTimeout(id);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const detail = errBody.detail || `HTTP ${res.status}: ${res.statusText}`;
      throw new Error(detail);
    }
    return await res.json();
  } catch (err: unknown) {
    clearTimeout(id);
    // Attempt 2: Direct localhost:8000 fallback
    try {
      const fallbackController = new AbortController();
      const fbId = setTimeout(() => fallbackController.abort(), timeoutMs);
      const res = await fetch(`${FALLBACK_V1_BASE}${path}`, {
        ...options,
        signal: fallbackController.signal,
        headers: reqHeaders,
      });
      clearTimeout(fbId);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const detail = errBody.detail || `Backend fallback HTTP ${res.status}`;
        throw new Error(detail);
      }
      return await res.json();
    } catch {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

async function fetchFromMarket<T>(endpoint: string, timeoutMs = 12000): Promise<T> {
  return fetchFromApi<T>(`/market${endpoint}`, { method: 'GET' }, timeoutMs);
}

function normalizeTicker(raw: Record<string, unknown>): MarketTicker {
  return {
    symbol: String(raw.symbol || ''),
    productId: Number(raw.product_id || raw.productId || 0),
    name: String(raw.name || raw.symbol || ''),
    baseAsset: String(raw.base_asset || raw.baseAsset || ''),
    quoteAsset: String(raw.quote_asset || raw.quoteAsset || 'USD'),
    contractType: String(raw.contract_type || raw.contractType || 'perpetual_futures'),
    lastPrice: Number(raw.last_price !== undefined ? raw.last_price : raw.lastPrice || 0),
    prevPrice: raw.prevPrice !== undefined ? Number(raw.prevPrice) : undefined,
    change24h: raw.change_24h !== undefined && raw.change_24h !== null ? Number(raw.change_24h) : raw.change24h !== undefined ? Number(raw.change24h) : null,
    high24h: raw.high_24h !== undefined && raw.high_24h !== null ? Number(raw.high_24h) : raw.high24h !== undefined ? Number(raw.high24h) : null,
    low24h: raw.low_24h !== undefined && raw.low_24h !== null ? Number(raw.low_24h) : raw.low24h !== undefined ? Number(raw.low24h) : null,
    volume24h: raw.volume_24h !== undefined && raw.volume_24h !== null ? Number(raw.volume_24h) : raw.volume24h !== undefined ? Number(raw.volume24h) : null,
    turnover24hUsd: raw.turnover_24h_usd !== undefined && raw.turnover_24h_usd !== null ? Number(raw.turnover_24h_usd) : raw.turnover24hUsd !== undefined ? Number(raw.turnover24hUsd) : null,
    markPrice: raw.mark_price !== undefined && raw.mark_price !== null ? Number(raw.mark_price) : raw.markPrice !== undefined ? Number(raw.markPrice) : null,
    spotPrice: raw.spot_price !== undefined && raw.spot_price !== null ? Number(raw.spot_price) : raw.spotPrice !== undefined ? Number(raw.spotPrice) : null,
    fundingRate: raw.funding_rate !== undefined && raw.funding_rate !== null ? Number(raw.funding_rate) : raw.fundingRate !== undefined ? Number(raw.fundingRate) : null,
    bestBid: raw.best_bid !== undefined && raw.best_bid !== null ? Number(raw.best_bid) : raw.bestBid !== undefined ? Number(raw.bestBid) : null,
    bestAsk: raw.best_ask !== undefined && raw.best_ask !== null ? Number(raw.best_ask) : raw.bestAsk !== undefined ? Number(raw.bestAsk) : null,
    timestamp: Number(raw.timestamp || Date.now()),
    lastUpdatedStr: String(raw.last_updated_str || raw.lastUpdatedStr || new Date().toLocaleTimeString()),
    priceDirection: (raw.price_direction || raw.priceDirection || 'same') as 'up' | 'down' | 'same',
  };
}

export async function getTickers(): Promise<MarketTicker[]> {
  const json = await fetchFromMarket<{ success: boolean; result: Record<string, unknown>[] }>('/tickers');
  if (!json || !Array.isArray(json.result)) {
    throw new Error('Invalid tickers response format from backend API');
  }

  return json.result.map(normalizeTicker);
}

export async function getTicker(symbol: string): Promise<MarketTicker | null> {
  const json = await fetchFromMarket<{ success: boolean; result: Record<string, unknown> }>(`/ticker/${symbol}`);
  if (!json || !json.result) return null;
  return normalizeTicker(json.result);
}

export async function getHistoricalCandles(
  symbol: string,
  resolution: ChartResolution = '1h',
  rangeConfig?: HistoryRangeConfig
): Promise<CandlesFetchResult> {
  const now = Math.floor(Date.now() / 1000);
  let start: number;
  let end: number = now;

  const rangeType = rangeConfig?.type || '7D';

  switch (rangeType) {
    case '1D':
      start = now - 86400;
      break;
    case '7D':
      start = now - 86400 * 7;
      break;
    case '1M':
      start = now - 86400 * 30;
      break;
    case '3M':
      start = now - 86400 * 90;
      break;
    case 'custom':
      start = rangeConfig?.start || now - 86400 * 7;
      end = rangeConfig?.end || now;
      break;
    default:
      start = now - 86400 * 7;
  }

  const query = `/candles?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&start=${start}&end=${end}`;
  const json = await fetchFromMarket<{
    success: boolean;
    symbol: string;
    resolution: string;
    candles: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
    limitation_notice?: string;
    range?: { start: number; end: number };
  }>(query);

  if (!json || !Array.isArray(json.candles)) {
    throw new Error('Invalid candle data received from backend API');
  }

  return {
    candles: json.candles,
    limitationNotice: json.limitation_notice,
    actualRange: {
      start: json.range?.start || (json.candles.length > 0 ? json.candles[0].time : start),
      end: json.range?.end || (json.candles.length > 0 ? json.candles[json.candles.length - 1].time : end),
    },
  };
}

export async function getMarketStats(): Promise<MarketStats> {
  const json = await fetchFromMarket<{ success: boolean; result: Record<string, unknown> }>('/stats');
  const res = json.result || {};

  return {
    btcPrice: res.btc_price !== undefined && res.btc_price !== null ? Number(res.btc_price) : null,
    btcChange24h: res.btc_change_24h !== undefined && res.btc_change_24h !== null ? Number(res.btc_change_24h) : null,
    btcVolume: res.btc_volume !== undefined && res.btc_volume !== null ? Number(res.btc_volume) : null,
    ethPrice: res.eth_price !== undefined && res.eth_price !== null ? Number(res.eth_price) : null,
    ethChange24h: res.eth_change_24h !== undefined && res.eth_change_24h !== null ? Number(res.eth_change_24h) : null,
    ethVolume: res.eth_volume !== undefined && res.eth_volume !== null ? Number(res.eth_volume) : null,
    totalTradingPairs: Number(res.total_trading_pairs || 0),
    activePerpetuals: Number(res.active_perpetuals || 0),
    totalVolumeUsd24h: res.total_volume_usd_24h !== undefined && res.total_volume_usd_24h !== null ? Number(res.total_volume_usd_24h) : null,
    gainersCount: Number(res.gainers_count || 0),
    losersCount: Number(res.losers_count || 0),
  };
}

export async function getProducts(): Promise<Record<string, unknown>[]> {
  const json = await fetchFromMarket<{ success: boolean; result: Record<string, unknown>[] }>('/products');
  return json.result || [];
}

export async function getBackendStatus(): Promise<{ status: string; upstream_connected: boolean; active_clients: number }> {
  return await fetchFromMarket<{ status: string; upstream_connected: boolean; active_clients: number }>('/status');
}

// ============================================================================
// Phase 3: Backtesting Engine API Clients
// ============================================================================

import type { BacktestRequest, BacktestResultData } from '../types/market';

export async function runBacktest(request: BacktestRequest): Promise<BacktestResultData> {
  const json = await fetchFromApi<{ success: boolean; result: BacktestResultData }>(
    '/backtesting/run',
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
    45000 // Allow up to 45s for deep multi-chunk candle fetching
  );

  if (!json || !json.result) {
    throw new Error('Invalid response received from backtest engine.');
  }

  return json.result;
}

export async function getBacktestResult(backtestId: string): Promise<BacktestResultData> {
  const json = await fetchFromApi<{ success: boolean; result: BacktestResultData }>(
    `/backtesting/results/${encodeURIComponent(backtestId)}`,
    { method: 'GET' }
  );

  if (!json || !json.result) {
    throw new Error(`Backtest ${backtestId} not found.`);
  }

  return json.result;
}

export async function getBacktestConfigOptions(): Promise<Record<string, any>> {
  const json = await fetchFromApi<{ success: boolean; config: Record<string, any> }>(
    '/backtesting/config-options',
    { method: 'GET' }
  );
  return json?.config || {};
}

// ============================================================================
// Phase 4: Strategy Evaluation & Robustness Testing API Clients
// ============================================================================

import type { EvaluationRequest, EvaluationResultData } from '../types/market';

export async function runEvaluation(request: EvaluationRequest): Promise<EvaluationResultData> {
  const json = await fetchFromApi<{ success: boolean; result: EvaluationResultData }>(
    '/evaluation/run',
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
    60000 // Allow up to 60s for full multi-parameter grid walk-forward evaluation
  );

  if (!json || !json.result) {
    throw new Error('Invalid response received from strategy evaluation engine.');
  }

  return json.result;
}

export async function getEvaluationResult(evaluationId: string): Promise<EvaluationResultData> {
  const json = await fetchFromApi<{ success: boolean; result: EvaluationResultData }>(
    `/evaluation/results/${encodeURIComponent(evaluationId)}`,
    { method: 'GET' }
  );

  if (!json || !json.result) {
    throw new Error(`Evaluation ${evaluationId} not found.`);
  }

  return json.result;
}

export async function getEvaluationConfigOptions(): Promise<Record<string, any>> {
  const json = await fetchFromApi<{ success: boolean; config: Record<string, any> }>(
    '/evaluation/config-options',
    { method: 'GET' }
  );
  return json?.config || {};
}

// ============================================================================
// Phase 6: Testnet Wallet & Account Dashboard API Clients
// ============================================================================

import type {
  AccountOverviewData,
  AccountAuthStatusData,
  RiskConfigData,
  TradingStatusData,
  RiskCheckRequestData,
  RiskCheckResultData,
  OrderPreviewRequestData,
  OrderPreviewResponseData,
  OrderConfirmRequestData,
  OrderExecutionRecordData,
  ExecutionStatusResponseData,
} from '../types/market';

export async function getAccountOverview(): Promise<AccountOverviewData> {
  const json = await fetchFromApi<{ success: boolean; overview: AccountOverviewData }>(
    '/account/overview',
    { method: 'GET' },
    18000
  );

  if (!json || !json.overview) {
    throw new Error('Invalid account overview response received from backend API.');
  }

  return json.overview;
}

export async function getAccountAuthStatus(): Promise<AccountAuthStatusData> {
  const json = await fetchFromApi<{ success: boolean; auth: AccountAuthStatusData }>(
    '/account/auth-status',
    { method: 'GET' },
    15000
  );

  if (!json || !json.auth) {
    throw new Error('Invalid account auth status response received from backend API.');
  }

  return json.auth;
}

// ============================================================================
// Phase 7.1: Risk & Safety Engine API Methods (Zero Live Order Execution)
// ============================================================================

export async function getTradingStatus(): Promise<TradingStatusData> {
  return fetchFromApi<TradingStatusData>('/trading/status', { method: 'GET' }, 12000);
}

export async function getRiskConfig(): Promise<RiskConfigData> {
  return fetchFromApi<RiskConfigData>('/trading/risk-config', { method: 'GET' }, 12000);
}

export async function updateRiskConfig(config: Partial<RiskConfigData>): Promise<{ message: string; config: RiskConfigData }> {
  return fetchFromApi<{ message: string; config: RiskConfigData }>(
    '/trading/risk-config',
    {
      method: 'PUT',
      body: JSON.stringify(config),
    },
    12000
  );
}

export async function checkSignalRisk(request: RiskCheckRequestData): Promise<RiskCheckResultData> {
  return fetchFromApi<RiskCheckResultData>(
    '/trading/risk-check',
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
    15000
  );
}

export async function engageKillSwitch(reason: string): Promise<TradingStatusData> {
  return fetchFromApi<TradingStatusData>(
    '/trading/kill-switch',
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
    12000
  );
}

export async function resetKillSwitch(confirm: boolean, reason: string): Promise<TradingStatusData> {
  return fetchFromApi<TradingStatusData>(
    '/trading/kill-switch/reset',
    {
      method: 'POST',
      body: JSON.stringify({ confirm, reason }),
    },
    12000
  );
}

// ============================================================================
// Phase 7.2: Secure Delta Exchange Testnet Order Execution API Methods
// ============================================================================

export async function getExecutionStatus(): Promise<ExecutionStatusResponseData> {
  return fetchFromApi<ExecutionStatusResponseData>('/trading/execution/status', { method: 'GET' }, 12000);
}

export async function createOrderPreview(request: OrderPreviewRequestData): Promise<OrderPreviewResponseData> {
  return fetchFromApi<OrderPreviewResponseData>(
    '/trading/orders/preview',
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
    15000
  );
}

export async function confirmAndSubmitOrder(request: OrderConfirmRequestData): Promise<OrderExecutionRecordData> {
  return fetchFromApi<OrderExecutionRecordData>(
    '/trading/orders/confirm',
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
    18000
  );
}

export async function listOrders(): Promise<OrderExecutionRecordData[]> {
  return fetchFromApi<OrderExecutionRecordData[]>('/trading/orders', { method: 'GET' }, 12000);
}

export async function getOrderDetail(orderId: string): Promise<OrderExecutionRecordData> {
  return fetchFromApi<OrderExecutionRecordData>(`/trading/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }, 12000);
}

export async function cancelOrder(orderId: string, reason?: string): Promise<OrderExecutionRecordData> {
  return fetchFromApi<OrderExecutionRecordData>(
    `/trading/orders/${encodeURIComponent(orderId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'Manual cancellation' }),
    },
    15000
  );
}

export async function reconcileOrder(orderId: string): Promise<OrderExecutionRecordData> {
  return fetchFromApi<OrderExecutionRecordData>(
    `/trading/orders/${encodeURIComponent(orderId)}/reconcile`,
    {
      method: 'POST',
    },
    15000
  );
}


