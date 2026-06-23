import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Search, Star, Trash2 } from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'tradingview-watchlist';
const DEFAULT_WATCHLIST = ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'NASDAQ:NVDA', 'NASDAQ:AAPL'];
const BINANCE_24HR_URL = 'https://api.binance.com/api/v3/ticker/24hr';
const BINANCE_FUTURES_PRICE_URL = 'https://fapi.binance.com/fapi/v1/ticker/price';

function normalizeSymbol(value) {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function toBinanceSymbol(symbol) {
  const rawSymbol = symbol.includes(':') ? symbol.split(':').at(-1) : symbol;
  return rawSymbol.replace('/', '').replace('-', '').toUpperCase();
}

function toBinanceFuturesSymbol(symbol) {
  const baseSymbol = toBinanceSymbol(symbol);
  return /(USDT|USDC|BTC|ETH|BNB)$/.test(baseSymbol) ? baseSymbol : `${baseSymbol}USDT`;
}

function canUseBinance(symbol) {
  return symbol.startsWith('BINANCE:') || /^[A-Z0-9]+(USDT|USDC|BTC|ETH|BNB)$/.test(symbol);
}

function canUseBinanceFutures(symbol) {
  return !symbol.startsWith('BINANCE:') || symbol.startsWith('BINANCE:');
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
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      calendar: false,
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
  const [quotes, setQuotes] = useState({});

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
      const binanceSymbols = [...new Set(watchlist.filter(canUseBinance).map(toBinanceSymbol))];
      const futuresSymbols = [
        ...new Set(
          watchlist
            .filter((symbol) => !canUseBinance(symbol) && canUseBinanceFutures(symbol))
            .map(toBinanceFuturesSymbol)
        )
      ];

      if (!binanceSymbols.length && !futuresSymbols.length) {
        setQuotes({});
        return;
      }

      try {
        const [spotQuotes, futuresQuotes] = await Promise.all([
          binanceSymbols.length
            ? fetch(`${BINANCE_24HR_URL}?symbols=${encodeURIComponent(JSON.stringify(binanceSymbols))}`, {
                signal: controller.signal
              }).then((response) => {
                if (!response.ok) throw new Error('Unable to load Binance spot quotes');
                return response.json();
              })
            : Promise.resolve([]),
          Promise.all(
            futuresSymbols.map(async (symbol) => {
              const response = await fetch(`${BINANCE_FUTURES_PRICE_URL}?symbol=${symbol}`, {
                signal: controller.signal
              });
              if (!response.ok) return null;
              return response.json();
            })
          )
        ]);

        const nextQuotes = {};

        spotQuotes.forEach((quote) => {
          nextQuotes[quote.symbol] = {
            price: quote.lastPrice,
            changePercent: quote.priceChangePercent,
            source: 'Spot'
          };
        });

        futuresQuotes.filter(Boolean).forEach((quote) => {
          nextQuotes[quote.symbol] = {
            price: quote.price,
            changePercent: null,
            source: 'Futures'
          };
        });

        setQuotes(nextQuotes);
      } catch (fetchError) {
        if (fetchError.name !== 'AbortError') {
          setQuotes({});
        }
      }
    }

    fetchQuotes();
    const intervalId = window.setInterval(fetchQuotes, 5000);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
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
    <main className="app-shell">
      <section className="chart-pane">
        <header className="topbar">
          <div>
            <span className="eyebrow">Live chart</span>
            <h1>{activeSymbol}</h1>
          </div>
          <div className="active-pill">
            <Star size={16} fill="currentColor" />
            Watchlist
          </div>
        </header>
        <div className="chart-frame">
          <TradingViewChart symbol={activeSymbol} />
        </div>
      </section>

      <aside className="watchlist-pane">
        <div className="watchlist-header">
          <div>
            <span className="eyebrow">Markets</span>
            <h2>Watchlist</h2>
          </div>
          <span className="count">{watchlist.length}</span>
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

        <div className="watchlist">
          {sortedWatchlist.map((symbol) => {
            const quoteKey = canUseBinance(symbol) ? toBinanceSymbol(symbol) : toBinanceFuturesSymbol(symbol);
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
                    {quote ? `${formatPrice(quote.price)} ${quote.source}` : 'No Binance quote'}
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
