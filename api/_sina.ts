import type { SinaGlobalQuotes } from './_types.ts';

const UA = 'Mozilla/5.0 (compatible; MarketTracker/1.0; +https://github.com/daiwanxing/MarketTracker)';

/**
 * 新浪财经全球资产通道：
 * - 费城半导体指数: gb_$sox
 * - 韩国 KOSPI 综合指数: b_KOSPI
 * - 美元指数: DINIW
 * - 伦敦金现货 (XAU/USD): hf_XAU
 */
export async function fetchSinaGlobalQuotes(timeoutMs = 3500): Promise<SinaGlobalQuotes> {
  const symbols = ['gb_$sox', 'b_KOSPI', 'DINIW', 'hf_XAU', 'USDCNY'];
  const url = `https://hq.sinajs.cn/list=${symbols.join(',')}`;
  const out: SinaGlobalQuotes = {};

  try {
    const res = await fetch(url, {
      headers: {
        'Referer': 'https://finance.sina.com.cn',
        'User-Agent': UA,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return out;
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);

    for (const line of text.split(';')) {
      const l = line.trim();
      if (!l || l.includes('FAILED')) continue;
      const eqIdx = l.indexOf('=');
      if (eqIdx === -1) continue;
      const key = l.slice(0, eqIdx).replace(/^var hq_str_/, '').trim();
      const rawVal = l.slice(eqIdx + 1).replace(/^"|"$/g, '').trim();
      const p = rawVal.split(',');

      if (key === 'gb_$sox' && p.length > 2) {
        const price = parseFloat(p[1]);
        const pct = parseFloat(p[2]);
        const prev = parseFloat(p[26] || p[7] || '0');
        if (!isNaN(price) && price > 0) {
          out.sox = {
            name: p[0] || '费城半导体指数',
            symbol: '^SOX',
            price,
            previousClose: isNaN(prev) || prev <= 0 ? undefined : prev,
            chg: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
            chgClass: pct > 0 ? 'up' : (pct < 0 ? 'down' : ''),
          };
        }
      } else if (key === 'b_KOSPI' && p.length > 3) {
        const price = parseFloat(p[1]);
        const pct = parseFloat(p[3]);
        const prev = parseFloat(p[8] || '0');
        if (!isNaN(price) && price > 0) {
          out.kospi = {
            name: p[0] || '韩国KOSPI指数',
            symbol: '^KS11',
            price,
            previousClose: isNaN(prev) || prev <= 0 ? undefined : prev,
            chg: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
            chgClass: pct > 0 ? 'up' : (pct < 0 ? 'down' : ''),
          };
        }
      } else if (key === 'DINIW' && p.length > 1) {
        const dxyPrice = parseFloat(p[1]);
        if (!isNaN(dxyPrice) && dxyPrice > 0) {
          out.dxy = parseFloat(dxyPrice.toFixed(2));
        }
      } else if (key === 'USDCNY' && p.length > 1) {
        const cnyRate = parseFloat(p[1]);
        if (!isNaN(cnyRate) && cnyRate > 0) {
          out.usdcny = parseFloat(cnyRate.toFixed(4));
        }
      } else if (key === 'hf_XAU' && p.length > 1) {
        const spotPrice = parseFloat(p[0]);
        const prevClose = parseFloat(p[1] || p[7] || '0');
        if (!isNaN(spotPrice) && spotPrice > 0) {
          const hasPrev = !isNaN(prevClose) && prevClose > 0;
          const pct = hasPrev ? ((spotPrice - prevClose) / prevClose) * 100 : 0;
          out.spotGold = {
            name: p[13] || '伦敦金现货',
            symbol: 'XAU',
            price: parseFloat(spotPrice.toFixed(2)),
            previousClose: hasPrev ? prevClose : undefined,
            chg: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
            chgClass: pct > 0 ? 'up' : (pct < 0 ? 'down' : ''),
          };
        }
      }
    }
  } catch {
    // 捕获异常，安全返回已解析字段
  }

  return out;
}
