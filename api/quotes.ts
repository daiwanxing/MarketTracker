import type { VercelRequest, VercelResponse } from '@vercel/node';

interface QuoteResult {
  symbol: string;
  price: number;
  previousClose?: number;
  chg: string;
  chgClass: 'up' | 'down' | '';
}

const UA = 'Mozilla/5.0 (compatible; MarketTracker/1.0; +https://github.com/daiwanxing/MarketTracker)';

const FALLBACK = {
  oil: {
    num: '98.80',
    chg: '-5.29%',
    chgClass: 'down' as const,
    quotes: { wti: 93.35, dxy: 101.23 },
  },
  gold: {
    num: '4120.30',
    chg: '-0.14%',
    chgClass: 'down' as const,
    quotes: { gc: 4150.2, dxy: 101.23, us10y: 5.184 },
  },
  techSemi: {
    sox: {
      name: '费城半导体指数',
      symbol: '^SOX',
      price: 12465.24,
      chg: '-1.61%',
      chgClass: 'down' as const,
      previousClose: 12668.93,
    },
    star50: {
      name: '科创50指数',
      symbol: '000688.SS',
      price: 1569.34,
      chg: '+0.86%',
      chgClass: 'up' as const,
      previousClose: 1555.98,
    },
    kospi: {
      name: '韩国KOSPI指数',
      symbol: '^KS11',
      price: 6870.81,
      chg: '-0.27%',
      chgClass: 'down' as const,
      previousClose: 6889.74,
    },
  },
  robot: {
    csRobot: {
      name: '中证机器人 ETF',
      symbol: '562500.SH',
      price: 0.897,
      chg: '-0.33%',
      chgClass: 'down' as const,
      previousClose: 0.900,
    },
    robo: {
      name: 'ROBO 机器人与自动化 ETF',
      symbol: 'ROBO',
      price: 82.55,
      chg: '+1.90%',
      chgClass: 'up' as const,
      previousClose: 81.01,
    },
    tsla: {
      name: '特斯拉 (TSLA)',
      symbol: 'TSLA',
      price: 354.11,
      chg: '-0.20%',
      chgClass: 'down' as const,
      previousClose: 354.81,
    },
  },
};

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
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
          };
        }>;
      };
    };
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const price = typeof meta?.regularMarketPrice === 'number' ? meta.regularMarketPrice : null;
    // 优先使用 regularMarketPreviousClose，若无则使用 chartPreviousClose / previousClose
    const prev = typeof (meta as Record<string, unknown>)?.regularMarketPreviousClose === 'number'
      ? (meta as Record<string, unknown>).regularMarketPreviousClose as number
      : (typeof meta?.chartPreviousClose === 'number'
        ? meta.chartPreviousClose
        : (typeof meta?.previousClose === 'number' ? meta.previousClose : null));

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
    const json = (await res.json()) as { price?: number };
    if (typeof json?.price === 'number') {
      return { price: json.price };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 腾讯财经秒级准实时行情抓取（国内持牌 Level-1 行情源，延迟通常在 3~10 秒以内）
 */
async function fetchTencentQuotes(symbols: string[], timeoutMs = 3000): Promise<Record<string, QuoteResult>> {
  const url = `https://qt.gtimg.cn/q=${symbols.join(',')}`;
  const out: Record<string, QuoteResult> = {};
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return out;
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    const lines = text.split(';').map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).replace(/^v_/, '').trim();
      const rawVal = line.slice(eqIdx + 1).replace(/^"|"$/g, '').trim();

      if (key.startsWith('hf_')) {
        // 期货格式: price, pct, buy, sell, high, low, time, prev, open, ..., name
        const parts = rawVal.split(',');
        const price = parseFloat(parts[0]);
        const pct = parseFloat(parts[1]);
        const prev = parseFloat(parts[7]);
        if (!isNaN(price) && price > 0) {
          out[key] = {
            symbol: key,
            price,
            previousClose: isNaN(prev) ? undefined : prev,
            chg: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
            chgClass: pct > 0 ? 'up' : (pct < 0 ? 'down' : ''),
          };
        }
      } else {
        // A股/美股格式: 1~name~code~price~prev~open~volume~...~chgAmt~chgPct
        const parts = rawVal.split('~');
        const price = parseFloat(parts[3]);
        const prev = parseFloat(parts[4]);
        const pct = parts[32] ? parseFloat(parts[32]) : (prev > 0 ? ((price - prev) / prev) * 100 : 0);
        if (!isNaN(price) && price > 0) {
          out[key] = {
            symbol: parts[2] || key,
            price,
            previousClose: isNaN(prev) ? undefined : prev,
            chg: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
            chgClass: pct > 0 ? 'up' : (pct < 0 ? 'down' : ''),
          };
        }
      }
    }
  } catch {
    // 失败静默回退
  }
  return out;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // 设置边缘缓存策略：全球 CDN 缓存 8 秒，20 秒内允许返回过期数据并在后台异步更新
  res.setHeader('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=20');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // 并发抓取：优先腾讯国内 Level-1 极速通道，同时并发拉取全球宏观与 Yahoo 兜底标的
  const tencentSymbols = ['sh000688', 'sh562500', 'usTSLA', 'usROBO', 'hf_OIL', 'hf_CL', 'hf_GC'];

  const [tencentRes, soxRes, ks11Res, star50Res, brentRes, wtiRes, dxyRes, gcRes, tnxRes, spotGoldRes, csRobotRes, roboRes, tslaRes] =
    await Promise.allSettled([
      fetchTencentQuotes(tencentSymbols),
      fetchYahooQuote('^SOX'),
      fetchYahooQuote('^KS11'),
      fetchYahooQuote('000688.SS'),
      fetchYahooQuote('BZ=F'),
      fetchYahooQuote('CL=F'),
      fetchYahooQuote('DX-Y.NYB'),
      fetchYahooQuote('GC=F'),
      fetchYahooQuote('^TNX'),
      fetchSpotGold(),
      fetchYahooQuote('562500.SS'),
      fetchYahooQuote('ROBO'),
      fetchYahooQuote('TSLA'),
    ]);

  const tcMap = tencentRes.status === 'fulfilled' ? tencentRes.value : {};
  const sox = soxRes.status === 'fulfilled' ? soxRes.value : null;
  const ks11 = ks11Res.status === 'fulfilled' ? ks11Res.value : null;
  const star50 = tcMap['sh000688'] ?? (star50Res.status === 'fulfilled' ? star50Res.value : null);
  const brent = tcMap['hf_OIL'] ?? (brentRes.status === 'fulfilled' ? brentRes.value : null);
  const wti = tcMap['hf_CL'] ?? (wtiRes.status === 'fulfilled' ? wtiRes.value : null);
  const dxy = dxyRes.status === 'fulfilled' ? dxyRes.value : null;
  const gc = tcMap['hf_GC'] ?? (gcRes.status === 'fulfilled' ? gcRes.value : null);
  const tnx = tnxRes.status === 'fulfilled' ? tnxRes.value : null;
  const spotGold = spotGoldRes.status === 'fulfilled' ? spotGoldRes.value : null;
  const csRobot = tcMap['sh562500'] ?? (csRobotRes.status === 'fulfilled' ? csRobotRes.value : null);
  const robo = tcMap['usROBO'] ?? (roboRes.status === 'fulfilled' ? roboRes.value : null);
  const tsla = tcMap['usTSLA'] ?? (tslaRes.status === 'fulfilled' ? tslaRes.value : null);

  // 1. 科技半导体组装
  const fbSemi = FALLBACK.techSemi;
  const techSemiData = {
    sox: {
      name: fbSemi.sox.name,
      symbol: fbSemi.sox.symbol,
      price: sox?.price ?? fbSemi.sox.price,
      chg: sox?.chg || fbSemi.sox.chg,
      chgClass: sox?.chgClass || fbSemi.sox.chgClass,
      previousClose: sox?.previousClose ?? fbSemi.sox.previousClose,
    },
    star50: {
      name: fbSemi.star50.name,
      symbol: fbSemi.star50.symbol,
      price: star50?.price ?? fbSemi.star50.price,
      chg: star50?.chg || fbSemi.star50.chg,
      chgClass: star50?.chgClass || fbSemi.star50.chgClass,
      previousClose: star50?.previousClose ?? fbSemi.star50.previousClose,
    },
    kospi: {
      name: fbSemi.kospi.name,
      symbol: fbSemi.kospi.symbol,
      price: ks11?.price ?? fbSemi.kospi.price,
      chg: ks11?.chg || fbSemi.kospi.chg,
      chgClass: ks11?.chgClass || fbSemi.kospi.chgClass,
      previousClose: ks11?.previousClose ?? fbSemi.kospi.previousClose,
    },
  };

  // 2. 原油组装
  const fbOil = FALLBACK.oil;
  const oilPrice = brent?.price ? brent.price.toFixed(2) : fbOil.num;
  const oilChg = brent?.chg || fbOil.chg;
  const oilChgClass = brent?.chgClass || fbOil.chgClass;
  const oilQuotes = {
    wti: wti?.price ?? fbOil.quotes.wti,
    dxy: dxy?.price ?? fbOil.quotes.dxy,
  };

  // 3. 黄金组装
  const fbGold = FALLBACK.gold;
  const goldPriceNum = spotGold?.price ?? (gc?.price ?? parseFloat(fbGold.num));
  const goldPrice = goldPriceNum.toFixed(2);
  const goldChg = gc?.chg || fbGold.chg;
  const goldChgClass = gc?.chgClass || fbGold.chgClass;
  const goldQuotes = {
    gc: gc?.price ?? fbGold.quotes.gc,
    dxy: dxy?.price ?? fbGold.quotes.dxy,
    us10y: tnx?.price ?? fbGold.quotes.us10y,
  };

  // 4. 机器人组装
  const fbRobot = FALLBACK.robot;
  const robotData = {
    csRobot: {
      name: fbRobot.csRobot.name,
      symbol: fbRobot.csRobot.symbol,
      price: csRobot?.price ?? fbRobot.csRobot.price,
      chg: csRobot?.chg || fbRobot.csRobot.chg,
      chgClass: csRobot?.chgClass || fbRobot.csRobot.chgClass,
      previousClose: csRobot?.previousClose ?? fbRobot.csRobot.previousClose,
    },
    robo: {
      name: fbRobot.robo.name,
      symbol: fbRobot.robo.symbol,
      price: robo?.price ?? fbRobot.robo.price,
      chg: robo?.chg || fbRobot.robo.chg,
      chgClass: robo?.chgClass || fbRobot.robo.chgClass,
      previousClose: robo?.previousClose ?? fbRobot.robo.previousClose,
    },
    tsla: {
      name: fbRobot.tsla.name,
      symbol: fbRobot.tsla.symbol,
      price: tsla?.price ?? fbRobot.tsla.price,
      chg: tsla?.chg || fbRobot.tsla.chg,
      chgClass: tsla?.chgClass || fbRobot.tsla.chgClass,
      previousClose: tsla?.previousClose ?? fbRobot.tsla.previousClose,
    },
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
      chg: goldChg,
      chgClass: goldChgClass,
      quotes: goldQuotes,
    },
    techSemi: techSemiData,
    robot: robotData,
  });
}
