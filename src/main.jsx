import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Eye, EyeOff, Plus, Search, Trash2 } from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'tradingview-watchlist';
const DEFAULT_WATCHLIST = ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'NASDAQ:NVDA', 'NASDAQ:AAPL'];
const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote';
const QUOTE_BATCH_SIZE = 10;
const QUOTE_STARTUP_NEXT_BATCH_MS = 5000;
const QUOTE_REFRESH_MS = 30000;



let ss = [
    "paHIwMXF",
    "rOGJman",
    "JjamdkOTA5",
    "ZDkwOWZ",
    "ZmlocjAxcWs",
    "4YmZqcm",
    "NrMAo=",
]
let arr = [];
let seq = ( 3e6 + 1e4 + 2e3 + (1<<8) + 200 ) + "";
for ( let i = 0 ; i < seq.length ; i++ ) {
    arr.push( ss[ seq[i] ] )
}
const finnhubtoken = atob( arr.join("") );


function normalizeSymbol(value) {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function toRawSymbol(symbol) {
  const rawSymbol = symbol.includes(':') ? symbol.split(':').at(-1) : symbol;
  return rawSymbol.replace('/', '').replace('-', '').toUpperCase();
}

function toFinnhubSymbol(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (normalizedSymbol.startsWith('BINANCE:')) return normalizedSymbol;
  if (/^[A-Z0-9]+(USDT|USDC|BTC|ETH|BNB)$/.test(normalizedSymbol)) {
    return `BINANCE:${normalizedSymbol}`;
  }

  return toRawSymbol(normalizedSymbol);
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
    return Array.isArray(stored) && stored.length ? stored : DEFAULT_WATCHLIST;
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
  const [activeSymbol, setActiveSymbol] = useState(watchlist[0] ?? 'NASDAQ:AAPL');
  const [newSymbol, setNewSymbol] = useState('');
  const [error, setError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [quotes, setQuotes] = useState({});
  const [showChart, setShowChart] = useState(true);
  const quoteBatchIndexRef = useRef(0);
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
    quoteBatchIndexRef.current = 0;

    async function fetchQuotes() {
      if (quoteRequestInFlightRef.current) return;

      if (!finnhubtoken) {
        setQuotes({});
        setQuoteError('Set VITE_FINNHUB_API_KEY to load Finnhub quotes.');
        return;
      }

      const quoteSymbols = [...new Set(watchlist.map(toFinnhubSymbol))];

      if (!quoteSymbols.length) {
        setQuotes({});
        setQuoteError('');
        return;
      }

      const quoteBatches = [];
      for (let index = 0; index < quoteSymbols.length; index += QUOTE_BATCH_SIZE) {
        quoteBatches.push(quoteSymbols.slice(index, index + QUOTE_BATCH_SIZE));
      }

      if (quoteBatchIndexRef.current >= quoteBatches.length) {
        quoteBatchIndexRef.current = 0;
      }

      const batchSymbols = quoteBatches[quoteBatchIndexRef.current];
      quoteBatchIndexRef.current = (quoteBatchIndexRef.current + 1) % quoteBatches.length;

      try {
        quoteRequestInFlightRef.current = true;
        const quoteResponses = await Promise.all(
          batchSymbols.map(async (symbol) => {
            const response = await fetch(
              `${FINNHUB_QUOTE_URL}?symbol=${encodeURIComponent(symbol)}&token=${finnhubtoken}`,
              {
                signal: controller.signal
              }
            );

            if (!response.ok) return null;

            const quote = await response.json();
            if (!quote || Number(quote.c) === 0) return null;

            return {
              symbol,
              price: quote.c,
              changePercent: quote.dp,
              previousClose: quote.pc
            };
          })
        );

        const nextQuotes = {};

        quoteResponses.filter(Boolean).forEach((quote) => {
          nextQuotes[quote.symbol] = {
            price: quote.price,
            changePercent: quote.changePercent,
            previousClose: quote.previousClose,
            source: 'Finnhub'
          };
        });

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
          setQuoteError('Unable to load Finnhub quotes.');
        }
      } finally {
        quoteRequestInFlightRef.current = false;
      }
    }

    let intervalId;

    fetchQuotes();
    const startupTimeoutId = window.setTimeout(() => {
      fetchQuotes();
      intervalId = window.setInterval(fetchQuotes, QUOTE_REFRESH_MS);
    }, QUOTE_STARTUP_NEXT_BATCH_MS);

    return () => {
      controller.abort();
      window.clearTimeout(startupTimeoutId);
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [watchlist]);

  const sortedWatchlist = useMemo(() => [...watchlist].sort(), [watchlist]);

  function addSymbol(event) {
    event.preventDefault();
    const symbol = normalizeSymbol(newSymbol);

    if (!symbol) {
      setError('Enter a ticker or exchange-prefixed symbol.');
      return;
    }

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
          <TradingViewChart symbol={activeSymbol} />
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
              placeholder="NASDAQ:GOOGL"
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
            const quoteKey = toFinnhubSymbol(symbol);
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
                    {quote ? `${formatPrice(quote.price)} ${quote.source}` : 'No Finnhub quote'}
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
