import type { QuoteItem } from './_types';

const UA = 'Mozilla/5.0 (compatible; MarketTracker/1.0; +https://github.com/daiwanxing/MarketTracker)';

/**
 * 腾讯财经秒级准实时行情抓取（国内持牌 Level-1 行情源，延迟 3~10 秒以内）
 * 支持:
 * - A 股指数/个股/ETF: sh000688, sh562500
 * - 美股单票/ETF: usTSLA, usROBO
 * - 连续期货主力合约: hf_OIL (布伦特), hf_CL (纽约原油), hf_GC (纽约黄金)
 */
export async function fetchTencentQuotes(
  symbols: string[],
  timeoutMs = 3500
): Promise<Record<string, QuoteItem>> {
  const url = `https://qt.gtimg.cn/q=${symbols.join(',')}`;
  const out: Record<string, QuoteItem> = {};
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
            name: parts[1],
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
    // 捕获异常，安全返回已解析字段，避免中断整个流程
  }
  return out;
}
