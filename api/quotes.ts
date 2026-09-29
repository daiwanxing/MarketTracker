import type { VercelRequest, VercelResponse } from '@vercel/node';
import oilFallback from '../src/data/oilData.json';
import goldFallback from '../src/data/goldData.json';
import techSemiFallback from '../src/data/techSemiData.json';

interface QuoteResult {
  symbol: string;
  price: number;
  previousClose?: number;
  chg: string;
  chgClass: 'up' | 'down' | '';
}

const UA = 'Mozilla/5.0 (compatible; MarketTracker/1.0; +https://github.com/daiwanxing/MarketTracker)';

/**
 * 带有超时控制的 Yahoo Finance 价格抓取
 */
async function fetchYahooQuote(symbol: string, timeoutMs = 4000): Promise<QuoteResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/plain,*/*',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const price = typeof meta?.regularMarketPrice === 'number' ? meta.regularMarketPrice : null;
    const prev = typeof meta?.chartPreviousClose === 'number'
      ? meta.chartPreviousClose
      : (typeof meta?.previousClose === 'number' ? meta.previousClose : null);

    if (price === null) return null;

    let chg = '';
    let chgClass: 'up' | 'down' | '' = '';
    if (prev !== null && prev > 0) {
      const pct = ((price - prev) / prev) * 100;
      chg = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
      chgClass = pct > 0 ? 'up' : (pct < 0 ? 'down' : '');
    }

    return {
      symbol,
      price,
      previousClose: prev ?? undefined,
      chg,
      chgClass,
    };
  } catch {
    return null;
  }
}

/**
 * 伦敦金现货抓取（gold-api.com 或 fallback）
 */
async function fetchSpotGold(timeoutMs = 3500): Promise<{ price: number } | null> {
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU', {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (typeof json?.price === 'number') {
      return { price: json.price };
    }
    return null;
  } catch {
    return null;
  }
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // 设置边缘缓存策略：全球 CDN 缓存 15 秒，45 秒内允许返回过期数据并在后台异步更新
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=45');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // 并发抓取核心标的（美股、亚太、大宗商品、宏观利率）
  const [soxRes, ks11Res, star50Res, brentRes, wtiRes, dxyRes, gcRes, tnxRes, spotGoldRes] =
    await Promise.allSettled([
      fetchYahooQuote('^SOX'),
      fetchYahooQuote('^KS11'),
      fetchYahooQuote('000688.SS'),
      fetchYahooQuote('BZ=F'),
      fetchYahooQuote('CL=F'),
      fetchYahooQuote('DX-Y.NYB'),
      fetchYahooQuote('GC=F'),
      fetchYahooQuote('^TNX'),
      fetchSpotGold(),
    ]);

  const sox = soxRes.status === 'fulfilled' ? soxRes.value : null;
  const ks11 = ks11Res.status === 'fulfilled' ? ks11Res.value : null;
  const star50 = star50Res.status === 'fulfilled' ? star50Res.value : null;
  const brent = brentRes.status === 'fulfilled' ? brentRes.value : null;
  const wti = wtiRes.status === 'fulfilled' ? wtiRes.value : null;
  const dxy = dxyRes.status === 'fulfilled' ? dxyRes.value : null;
  const gc = gcRes.status === 'fulfilled' ? gcRes.value : null;
  const tnx = tnxRes.status === 'fulfilled' ? tnxRes.value : null;
  const spotGold = spotGoldRes.status === 'fulfilled' ? spotGoldRes.value : null;

  // 1. 科技半导体组装
  const fbSemi = techSemiFallback.benchmarks;
  const techSemiData = {
    sox: {
      name: '费城半导体指数',
      symbol: '^SOX',
      price: sox?.price ?? fbSemi.sox.price,
      chg: sox?.chg || fbSemi.sox.chg,
      chgClass: sox?.chgClass || fbSemi.sox.chgClass,
      previousClose: sox?.previousClose ?? fbSemi.sox.previousClose,
    },
    star50: {
      name: '科创50指数',
      symbol: '000688.SS',
      price: star50?.price ?? fbSemi.star50.price,
      chg: star50?.chg || fbSemi.star50.chg,
      chgClass: star50?.chgClass || fbSemi.star50.chgClass,
      previousClose: star50?.previousClose ?? fbSemi.star50.previousClose,
    },
    kospi: {
      name: '韩国KOSPI指数',
      symbol: '^KS11',
      price: ks11?.price ?? fbSemi.kospi.price,
      chg: ks11?.chg || fbSemi.kospi.chg,
      chgClass: ks11?.chgClass || fbSemi.kospi.chgClass,
      previousClose: ks11?.previousClose ?? fbSemi.kospi.previousClose,
    },
  };

  // 2. 原油组装
  const fbOil = oilFallback.metrics.main;
  const oilPrice = brent?.price ? brent.price.toFixed(2) : fbOil.num;
  const oilChg = brent?.chg || fbOil.chg;
  const oilChgClass = brent?.chgClass || fbOil.chgClass;
  const oilQuotes = {
    wti: wti?.price ?? fbOil.quotes.wti,
    dxy: dxy?.price ?? fbOil.quotes.dxy,
  };

  // 3. 黄金组装
  const fbGold = goldFallback.metrics.main;
  const goldPriceNum = spotGold?.price ?? (typeof fbGold.num === 'string' ? parseFloat(fbGold.num) : fbGold.num);
  const goldPrice = typeof goldPriceNum === 'number' ? goldPriceNum.toFixed(2) : String(goldPriceNum);
  const goldQuotes = {
    gc: gc?.price ?? fbGold.quotes.gc,
    dxy: dxy?.price ?? fbGold.quotes.dxy,
    us10y: tnx?.price ?? 5.184,
  };

  return res.status(200).json({
    status: 'ok',
    asOf: new Date().toISOString(),
    oil: {
      price: oilPrice,
      chg: oilChg,
      chgClass: oilChgClass,
      quotes: oilQuotes,
    },
    gold: {
      price: goldPrice,
      chg: fbGold.chg,
      chgClass: fbGold.chgClass,
      quotes: goldQuotes,
    },
    techSemi: techSemiData,
  });
}
