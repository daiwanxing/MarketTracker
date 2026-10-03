import http from 'http';
import type { SectorCrowdingResult, EastmoneyYieldResult, QuoteItem } from './_types.ts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/**
 * 东方财富行情中心：上海金集中定价基准合约 (118.SHAU)
 * 对应页面: https://quote.eastmoney.com/globalfuture/SHAU.html
 */
export function fetchEastmoneyShau(timeoutMs = 3000): Promise<QuoteItem | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'push2.eastmoney.com',
      port: 80,
      path: '/api/qt/stock/get?secid=118.SHAU&fields=f43,f44,f45,f46,f58,f59,f60,f169,f170',
      family: 4,
      headers: {
        'User-Agent': UA,
        'Referer': 'http://quote.eastmoney.com/',
      },
      timeout: timeoutMs,
    };

    const req = http.get(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          const d = json?.data;
          if (!d || typeof d.f43 !== 'number') return resolve(null);
          const factor = Math.pow(10, d.f59 || 2);
          const price = parseFloat((d.f43 / factor).toFixed(2));
          const pct = typeof d.f170 === 'number' ? d.f170 / 100 : 0;
          const chgAmt = typeof d.f169 === 'number' ? d.f169 / factor : 0;
          const prev = parseFloat((price - chgAmt).toFixed(2));
          resolve({
            name: d.f58 || '上海金',
            symbol: 'SHAU',
            price,
            previousClose: prev > 0 ? prev : undefined,
            chg: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
            chgClass: pct > 0 ? 'up' : (pct < 0 ? 'down' : ''),
          });
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * 东方财富官方数据中心：中美国债基准收益率 (含 US10Y / US2Y)
 */
export async function fetchEastmoneyYields(timeoutMs = 3000): Promise<EastmoneyYieldResult> {
  const url =
    'https://datacenter.eastmoney.com/api/data/get?type=RPTA_WEB_TREASURYYIELD&sty=ALL&st=SOLAR_DATE&sr=-1&token=894050c76af8597a853f5b408b759f5d&p=1&ps=1';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://data.eastmoney.com/',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return {};
    const d = await res.json();
    const row = d?.result?.data?.[0];
    if (!row) return {};
    return {
      us10y: row.EMG00001310 ? parseFloat(parseFloat(row.EMG00001310).toFixed(3)) : null,
      us2y: row.EMG00001308 ? parseFloat(parseFloat(row.EMG00001308).toFixed(3)) : null,
      asOf: row.SOLAR_DATE ? String(row.SOLAR_DATE).slice(0, 10) : null,
    };
  } catch {
    return {};
  }
}

/**
 * 东方财富秒级全市场微观拥挤度聚合抓取（7 核心标的单次打包，约 80ms）
 * 强制 IPv4 (family: 4) 避免 IPv6 握手熔断
 */
export function fetchEastmoneyCrowding(timeoutMs = 3000): Promise<SectorCrowdingResult | null> {
  return new Promise((resolve) => {
    const secids = '1.000001,0.399106,90.BK1201,90.BK1215,90.BK1207,90.BK0486,2.H30590';
    const options = {
      hostname: 'push2.eastmoney.com',
      port: 80,
      path: `/api/qt/ulist.np/get?secids=${secids}&fields=f2,f3,f6,f12,f14`,
      family: 4,
      headers: {
        'User-Agent': UA,
        'Referer': 'http://quote.eastmoney.com/',
      },
      timeout: timeoutMs,
    };

    const req = http.get(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const diff = data?.data?.diff;
          if (!Array.isArray(diff) || diff.length === 0) return resolve(null);
          const map: Record<string, { f6?: number }> = {};
          for (const item of diff) {
            if (item && item.f12) map[item.f12] = item;
          }

          const shAmt = (map['000001']?.f6 || 0) / 1e8;
          const szAmt = (map['399106']?.f6 || 0) / 1e8;
          const marketTotal = shAmt + szAmt;
          if (marketTotal <= 0) return resolve(null);

          const dz = (map['BK1201']?.f6 || 0) / 1e8;
          const tx = (map['BK1215']?.f6 || 0) / 1e8;
          const jsj = (map['BK1207']?.f6 || 0) / 1e8;
          const cm = (map['BK0486']?.f6 || 0) / 1e8;
          const tmtTotal = dz + tx + jsj + cm;
          const tmtShare = parseFloat(((tmtTotal / marketTotal) * 100).toFixed(2));

          let tmtZone = 'neutral';
          let tmtLabel = '主线活跃';
          if (tmtShare >= 38.0) {
            tmtZone = 'danger';
            tmtLabel = '极端过热';
          } else if (tmtShare >= 32.0) {
            tmtZone = 'warning';
            tmtLabel = '拥挤偏热';
          } else if (tmtShare < 20.0) {
            tmtZone = 'cold';
            tmtLabel = '低位冰点';
          }

          const robotAmt = (map['H30590']?.f6 || 0) / 1e8;
          const robotShare = parseFloat(((robotAmt / marketTotal) * 100).toFixed(2));

          let robotZone = 'neutral';
          let robotLabel = '温和中位';
          if (robotShare >= 3.8) {
            robotZone = 'danger';
            robotLabel = '极端过热';
          } else if (robotShare >= 2.8) {
            robotZone = 'warning';
            robotLabel = '偏热';
          } else if (robotShare >= 1.5) {
            robotZone = 'neutral';
            robotLabel = '活跃';
          } else if (robotShare < 0.8) {
            robotZone = 'cold';
            robotLabel = '低位冰点';
          }

          resolve({
            market: {
              shAmountYi: parseFloat(shAmt.toFixed(2)),
              szAmountYi: parseFloat(szAmt.toFixed(2)),
              marketAmountYi: parseFloat(marketTotal.toFixed(2)),
            },
            techSemi: {
              tmtAmountYi: parseFloat(tmtTotal.toFixed(2)),
              marketAmountYi: parseFloat(marketTotal.toFixed(2)),
              value: tmtShare,
              zone: tmtZone,
              label: tmtLabel,
            },
            robot: {
              robotAmountYi: parseFloat(robotAmt.toFixed(2)),
              marketAmountYi: parseFloat(marketTotal.toFixed(2)),
              value: robotShare,
              zone: robotZone,
              label: robotLabel,
            },
          });
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}
