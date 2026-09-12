import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Eye, EyeOff, Plus, Search, Trash2 } from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'tradingview-watchlist';
const DEFAULT_WATCHLIST = ['BTCUSDT:BTCUSDT', 'ETHUSDT:ETHUSDT', 'SOLUSDT:SOLUSDT', 'NVDA:NVDA', 'AAPL:AAPL'];
const QUOTE_URL = 'https://molecule-dev.muaverse.build/polyrouter/get_fapi_quotes';
const QUOTE_REFRESH_MS = 30000;
function normalizeSymbol(value) {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function toRawSymbol(symbol) {
  return symbol.replace('/', '').replace('-', '').toUpperCase();
}

function parseSymbolEntry(value) {
  const normalized = normalizeSymbol(value);
  const separatorIndex = normalized.indexOf(':');

  if (separatorIndex === -1) {
    const symbol = toRawSymbol(normalized);
    return { muaverseSymbol: symbol, tradingViewSymbol: symbol };
  }

  const muaverseSymbol = toRawSymbol(normalized.slice(0, separatorIndex));
  const tradingViewSymbol = toRawSymbol(normalized.slice(separatorIndex + 1));
  return { muaverseSymbol, tradingViewSymbol };
}

function normalizeSymbolEntry(value) {
  const { muaverseSymbol, tradingViewSymbol } = parseSymbolEntry(value);
  return `${muaverseSymbol}:${tradingViewSymbol || muaverseSymbol}`;
}

function toServerSymbol(symbol) {
  return parseSymbolEntry(symbol).muaverseSymbol;
}

function toTradingViewSymbol(symbol) {
  return parseSymbolEntry(symbol).tradingViewSymbol;
}

function normalizeQuoteResponse(payload) {
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Object.entries(payload?.data ?? payload ?? {}).map(([symbol, quote]) => ({
          symbol,
          ...(quote && typeof quote === 'object' ? quote : { price: quote })
        }));

  return values.reduce((result, quote) => {
    if (!quote || typeof quote !== 'object') return result;

    const symbol = toServerSymbol(quote.symbol ?? quote.s ?? quote.ticker ?? '');
    const price = quote.price ?? quote.lastPrice ?? quote.last ?? quote.c ?? quote.markPrice;
    const changePercent = quote.changePercent ?? quote.percentChange ?? quote.dp ?? quote.P;
    const previousClose = quote.previousClose ?? quote.prevClosePrice ?? quote.pc;

    if (symbol && price != null) {
      result[symbol] = { price, changePercent, previousClose, source: 'Binance' };
    }
    return result;
  }, {});
}

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return '-';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: price >= 100 ? 2 : price >= 1 ? 4 : 8
  }).format(price);
}

function formatPercent(value) {
  if (value == null) return '-';
  const percent = Number(value);
  if (!Number.isFinite(percent)) return '-';
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

function loadWatchlist() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) && stored.length
      ? stored.map(normalizeSymbolEntry)
      : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function TradingViewChart({ symbol }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container__widget';
    containerRef.current.appendChild(widgetContainer);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'D',
      timezone: 'Asia/Singapore',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      calendar: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      support_host: 'https://www.tradingview.com'
    });
    containerRef.current.appendChild(script);
  }, [symbol]);

  return <div className="tradingview-widget-container" ref={containerRef} />;
}

function App() {
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const [activeSymbol, setActiveSymbol] = useState(watchlist[0] ?? 'AAPL:AAPL');
  const [newSymbol, setNewSymbol] = useState('');
  const [error, setError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [quotes, setQuotes] = useState({});
  const [showChart, setShowChart] = useState(true);
  const quoteRequestInFlightRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    if (!watchlist.includes(activeSymbol) && watchlist.length) {
      setActiveSymbol(watchlist[0]);
    }
  }, [activeSymbol, watchlist]);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchQuotes() {
      if (quoteRequestInFlightRef.current) return;

      const quoteSymbols = [...new Set(watchlist.map(toServerSymbol))];

      if (!quoteSymbols.length) {
        setQuotes({});
        setQuoteError('');
        return;
      }

      try {
        quoteRequestInFlightRef.current = true;
        const response = await fetch(
          `${QUOTE_URL}?symbols=${encodeURIComponent(quoteSymbols.join(','))}`,
          { signal: controller.signal }
        );

        if (!response.ok) throw new Error(`Quote request failed: ${response.status}`);

        const nextQuotes = normalizeQuoteResponse(await response.json());

        setQuotes((currentQuotes) => {
          const validSymbols = new Set(quoteSymbols);
          const mergedQuotes = Object.fromEntries(
            Object.entries(currentQuotes).filter(([symbol]) => validSymbols.has(symbol))
          );

          return {
            ...mergedQuotes,
            ...nextQuotes
          };
        });
        setQuoteError('');
      } catch (fetchError) {
        if (fetchError.name !== 'AbortError') {
          setQuoteError('Unable to load Muaverse quotes.');
        }
      } finally {
        quoteRequestInFlightRef.current = false;
      }
    }

    fetchQuotes();
    const intervalId = window.setInterval(fetchQuotes, QUOTE_REFRESH_MS);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [watchlist]);

  const sortedWatchlist = useMemo(() => [...watchlist].sort(), [watchlist]);

  function addSymbol(event) {
    event.preventDefault();
    if (!normalizeSymbol(newSymbol)) {
      setError('Enter a Muaverse symbol, optionally followed by :TradingViewSymbol.');
      return;
    }

    const symbol = normalizeSymbolEntry(newSymbol);

    if (watchlist.includes(symbol)) {
      setActiveSymbol(symbol);
      setNewSymbol('');
      setError('');
      return;
    }

    setWatchlist((current) => [...current, symbol]);
    setActiveSymbol(symbol);
    setNewSymbol('');
    setError('');
  }

  function removeSymbol(symbol) {
    setWatchlist((current) => current.filter((item) => item !== symbol));
  }

  return (
    <main className={`app-shell ${showChart ? '' : 'is-chart-hidden'}`}>
      {showChart ? (
        <section className="chart-pane">
        <header className="topbar">
          <div>
            <span className="eyebrow">Live chart</span>
            <h1>{activeSymbol}</h1>
          </div>
          <button
            className="icon-ghost-button"
            type="button"
            onClick={() => setShowChart(false)}
            aria-label="Hide chart"
            title="Hide chart"
          >
            <EyeOff size={17} />
          </button>
        </header>
        <div className="chart-frame">
          <TradingViewChart symbol={toTradingViewSymbol(activeSymbol)} />
        </div>
      </section>
      ) : null}

      <aside className="watchlist-pane">
        <div className="watchlist-header">
          <div>
            <span className="eyebrow">Markets</span>
            <h2>Watchlist</h2>
          </div>
          <div className="watchlist-actions">
            <button
              className="icon-ghost-button"
              type="button"
              onClick={() => setShowChart((current) => !current)}
              aria-label={showChart ? 'Hide chart' : 'Show chart'}
              title={showChart ? 'Hide chart' : 'Show chart'}
            >
              {showChart ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
            <span className="count">{watchlist.length}</span>
          </div>
        </div>

        <form className="add-form" onSubmit={addSymbol}>
          <label className="input-wrap" htmlFor="symbol">
            <Search size={17} />
            <input
              id="symbol"
              value={newSymbol}
              onChange={(event) => setNewSymbol(event.target.value)}
              placeholder="BINANCE_SYMBOL:TRADINGVIEW_SYMBOL"
              autoComplete="off"
            />
          </label>
          <button className="icon-button" type="submit" aria-label="Add ticker" title="Add ticker">
            <Plus size={20} />
          </button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
        {quoteError ? <p className="form-error">{quoteError}</p> : null}

        <div className="watchlist">
          {sortedWatchlist.map((symbol) => {
            const quoteKey = toServerSymbol(symbol);
            const quote = quotes[quoteKey];
            const isPositive = Number(quote?.changePercent) >= 0;

            return (
              <button
                className={`watchlist-row ${symbol === activeSymbol ? 'is-active' : ''}`}
                key={symbol}
                type="button"
                onClick={() => setActiveSymbol(symbol)}
              >
                <span className="symbol-cell">
                  <strong>{symbol}</strong>
                  <span className="price-line">
                    {quote ? `${formatPrice(quote.price)} ${quote.source}` : 'No Muaverse quote'}
                  </span>
                </span>
                <span
                  className={`change-cell ${
                    quote?.changePercent == null ? '' : isPositive ? 'is-positive' : 'is-negative'
                  }`}
                >
                  {quote ? formatPercent(quote.changePercent) : '-'}
                </span>
                <Trash2
                  aria-label={`Remove ${symbol}`}
                  className="remove-icon"
                  role="button"
                  size={17}
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeSymbol(symbol);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      removeSymbol(symbol);
                    }
                  }}
                />
              </button>
            );
          })}
        </div>
      </aside>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
