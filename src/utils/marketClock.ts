/**
 * 全球半导体核心市场（科创50、韩国KOSPI、美股费城半导体）时钟状态机
 * 
 * 依据客户端当前北京时间（Asia/Shanghai / CST, UTC+8）动态精确推导：
 * 1. 各市场的真实交易阶段（盘中交易 / 盘前待开 / 集合竞价 / 午休 / 已收盘 / 周末休市）
 * 2. 全球半导体宏观交易阶段（Trading Phase）与时间窗口
 * 3. 实时联动 benchmarks 最新行情报价，防止与宏观报价割裂
 */

export type MarketStatus =
  | 'TRADING'
  | 'CLOSED'
  | 'PENDING_OPEN'
  | 'PRE_MARKET'
  | 'INTERMISSION'
  | 'WEEKEND'
  | 'HOLIDAY';

export interface MarketClockItem {
  symbol: string;
  name: string;
  status: MarketStatus;
  statusLabel: string;
  price: number | string;
  chg: string;
  chgClass: string;
  role: string;
}

export interface TradingPhase {
  phase: string;
  headline: string;
  window: string;
}

interface BenchmarkQuote {
  name?: string;
  symbol?: string;
  price?: number;
  chg?: string;
  chgClass?: string;
}

export interface BeijingTimeInfo {
  year: number;
  month: number; // 1-12
  date: number; // 1-31
  day: number; // 0 (Sun) - 6 (Sat)
  hours: number;
  minutes: number;
  totalMinutes: number; // hours * 60 + minutes
}

/**
 * 将任意 Date 对象转换为精确的北京时间分量 (Asia/Shanghai)
 */
export function getBeijingTime(now: Date = new Date()): BeijingTimeInfo {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  });

  const parts = formatter.formatToParts(now);
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let date = now.getDate();
  let hours = now.getHours();
  let minutes = now.getMinutes();
  let weekdayStr = 'Mon';

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    if (part.type === 'month') month = parseInt(part.value, 10);
    if (part.type === 'day') date = parseInt(part.value, 10);
    if (part.type === 'hour') hours = parseInt(part.value, 10);
    if (part.type === 'minute') minutes = parseInt(part.value, 10);
    if (part.type === 'weekday') weekdayStr = part.value;
  }

  if (hours === 24) hours = 0;

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const day = dayMap[weekdayStr] ?? 1;

  return {
    year,
    month,
    date,
    day,
    hours,
    minutes,
    totalMinutes: hours * 60 + minutes,
  };
}

/**
 * 判断美东当前是否处于夏令时 (EDT: UTC-4) 还是冬令时 (EST: UTC-5)
 */
export function isUSDaylightSaving(now: Date = new Date()): boolean {
  try {
    const nyStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyDate = new Date(nyStr);
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const utcDate = new Date(utcStr);
    const diffHours = (utcDate.getTime() - nyDate.getTime()) / (1000 * 60 * 60);
    return Math.round(diffHours) === 4;
  } catch {
    // 降级经验规则：3月第二个周日至11月第一个周日为夏令时
    const bj = getBeijingTime(now);
    return bj.month >= 4 && bj.month <= 10;
  }
}

/**
 * 中国 A 股常见法定节假日休市识别 (格式: YYYY-MM-DD)
 */
function getChinaHoliday(month: number, date: number): string | null {
  const mmdd = `${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  // 元旦
  if (mmdd === '01-01' || mmdd === '01-02' || mmdd === '01-03') return '元旦休市';
  // 劳动节
  if (mmdd >= '05-01' && mmdd <= '05-05') return '劳动节休市';
  // 国庆节
  if (mmdd >= '10-01' && mmdd <= '10-07') return '国庆长假休市';
  return null;
}

/**
 * 美股主要法定节假日休市识别
 */
function getUSHoliday(month: number, date: number): string | null {
  const mmdd = `${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  if (mmdd === '01-01') return '元旦休市';
  if (mmdd === '07-04') return '独立日休市';
  if (mmdd === '12-25') return '圣诞节休市';
  return null;
}

/**
 * 获取科创50（A股）的实时交易状态
 */
export function getStar50Status(bj: BeijingTimeInfo): { status: MarketStatus; statusLabel: string } {
  // 节假日休市
  const holiday = getChinaHoliday(bj.month, bj.date);
  if (holiday) {
    return { status: 'HOLIDAY', statusLabel: holiday };
  }

  // 周末休市
  if (bj.day === 0 || bj.day === 6) {
    return { status: 'WEEKEND', statusLabel: '周末休市' };
  }

  const m = bj.totalMinutes;
  const t915 = 9 * 60 + 15;
  const t925 = 9 * 60 + 25;
  const t930 = 9 * 60 + 30;
  const t1130 = 11 * 60 + 30;
  const t1300 = 13 * 60;
  const t1500 = 15 * 60;

  if (m < t915) {
    return { status: 'PENDING_OPEN', statusLabel: '待开盘 09:30' };
  }
  if (m >= t915 && m < t925) {
    return { status: 'PRE_MARKET', statusLabel: '集合竞价 09:15-09:25' };
  }
  if (m >= t925 && m < t930) {
    return { status: 'PRE_MARKET', statusLabel: '静默待开 09:30' };
  }
  if (m >= t930 && m < t1130) {
    return { status: 'TRADING', statusLabel: '盘中交易 09:30-11:30' };
  }
  if (m >= t1130 && m < t1300) {
    return { status: 'INTERMISSION', statusLabel: '午间休市' };
  }
  if (m >= t1300 && m < t1500) {
    return { status: 'TRADING', statusLabel: '盘中交易 13:00-15:00' };
  }
  return { status: 'CLOSED', statusLabel: '已收盘 15:00' };
}

/**
 * 获取韩国KOSPI指数的实时交易状态（首尔 09:00 - 15:30 连续交易，北京时间 08:00 - 14:30）
 */
function getKospiStatus(bj: BeijingTimeInfo): { status: MarketStatus; statusLabel: string } {
  if (bj.day === 0 || bj.day === 6) {
    return { status: 'WEEKEND', statusLabel: '周末休市' };
  }

  const m = bj.totalMinutes;
  const t0800 = 8 * 60;
  const t1430 = 14 * 60 + 30;

  if (m < t0800) {
    return { status: 'PENDING_OPEN', statusLabel: '待开盘 08:00' };
  }
  if (m >= t0800 && m < t1430) {
    return { status: 'TRADING', statusLabel: '盘中交易 08:00-14:30' };
  }
  return { status: 'CLOSED', statusLabel: '已收盘 14:30' };
}

/**
 * 获取费城半导体指数 (^SOX) 的实时交易状态
 * 美东常规交易时间 09:30 - 16:00
 * 夏令时对应北京时间：21:30 - 次日 04:00（盘前 16:00 - 21:30）
 * 冬令时对应北京时间：22:30 - 次日 05:00（盘前 17:00 - 22:30）
 */
export function getSoxStatus(
  bj: BeijingTimeInfo,
  isDst: boolean
): { status: MarketStatus; statusLabel: string } {
  const openMinutes = isDst ? 21 * 60 + 30 : 22 * 60 + 30;
  const closeMinutes = isDst ? 4 * 60 : 5 * 60;
  const preMinutes = isDst ? 16 * 60 : 17 * 60;
  const openLabel = isDst ? '21:30' : '22:30';
  const closeLabel = isDst ? '04:00' : '05:00';

  const m = bj.totalMinutes;
  const day = bj.day; // 0: Sun, 1: Mon, ..., 5: Fri, 6: Sat

  const usHoliday = getUSHoliday(bj.month, bj.date);
  if (usHoliday) {
    return { status: 'HOLIDAY', statusLabel: usHoliday };
  }

  // 1. 周六：北京时间 00:00 至 closeMinutes (04:00/05:00) 仍然是美股周五尾盘常规交易！
  if (day === 6) {
    if (m < closeMinutes) {
      return { status: 'TRADING', statusLabel: `盘中交易 ~${closeLabel}` };
    }
    return { status: 'WEEKEND', statusLabel: '周末休市' };
  }

  // 2. 周日：全天周末休市
  if (day === 0) {
    return { status: 'WEEKEND', statusLabel: '周末休市' };
  }

  // 3. 周一：
  if (day === 1) {
    if (m < preMinutes) {
      return { status: 'PENDING_OPEN', statusLabel: `待开盘 ${openLabel}` };
    }
    if (m < openMinutes) {
      return { status: 'PRE_MARKET', statusLabel: `盘前待开 ${openLabel}` };
    }
    return { status: 'TRADING', statusLabel: `盘中交易 ~${closeLabel}` };
  }

  // 4. 周二至周五：
  // 凌晨 00:00 至 closeMinutes (04:00/05:00)：前一晚的美股交易时段
  if (m < closeMinutes) {
    return { status: 'TRADING', statusLabel: `盘中交易 ~${closeLabel}` };
  }
  // 凌晨收盘后至下午盘前 (04:00 ~ 16:00)：已收盘
  if (m >= closeMinutes && m < preMinutes) {
    return { status: 'CLOSED', statusLabel: `已收盘 ${closeLabel}` };
  }
  // 下午盘前 (16:00 ~ 21:30)：盘前交易 / 待开盘
  if (m >= preMinutes && m < openMinutes) {
    return { status: 'PRE_MARKET', statusLabel: `盘前待开 ${openLabel}` };
  }
  // 晚上 (21:30 ~ 24:00)：美股主力交易时段
  return { status: 'TRADING', statusLabel: `盘中交易 ~${closeLabel}` };
}

/**
 * 获取当前全球半导体宏观交易阶段
 */
function getTradingPhase(bj: BeijingTimeInfo, isDst: boolean): TradingPhase {
  const day = bj.day;
  const m = bj.totalMinutes;
  const usOpenMinutes = isDst ? 21 * 60 + 30 : 22 * 60 + 30;
  const usCloseMinutes = isDst ? 4 * 60 : 5 * 60;
  const usOpenLabel = isDst ? '21:30' : '22:30';
  const usCloseLabel = isDst ? '04:00' : '05:00';

  // 周六 15:00 之后到周日全天，到周一 08:00 之前属于周末休市窗口
  if (day === 0 || (day === 6 && m >= 15 * 60) || (day === 1 && m < 8 * 60)) {
    return {
      phase: 'GLOBAL_WEEKEND',
      headline: '全球周末休市 · 宏观周报窗口',
      window: 'WEEKEND CST',
    };
  }

  // 08:00 ~ 09:30 CST
  if (m >= 8 * 60 && m < 9 * 60 + 30) {
    return {
      phase: 'APAC_PRE_MARKET',
      headline: '亚太开盘先导 · 韩国盘中 / A股集合竞价',
      window: '08:00 ~ 09:30 CST',
    };
  }

  // 09:30 ~ 11:30 CST
  if (m >= 9 * 60 + 30 && m < 11 * 60 + 30) {
    return {
      phase: 'APAC_MORNING_SESSION',
      headline: '亚太早盘主力 · A股 / 韩股共振交易窗口',
      window: '09:30 ~ 11:30 CST',
    };
  }

  // 11:30 ~ 13:00 CST
  if (m >= 11 * 60 + 30 && m < 13 * 60) {
    return {
      phase: 'APAC_INTERMISSION',
      headline: 'A股午间休市 · 韩国KOSPI持续交易窗口',
      window: '11:30 ~ 13:00 CST',
    };
  }

  // 13:00 ~ 15:00 CST
  if (m >= 13 * 60 && m < 15 * 60) {
    return {
      phase: 'APAC_AFTERNOON_SESSION',
      headline: '亚太午后决胜 · A股收盘定价窗口',
      window: '13:00 ~ 15:00 CST',
    };
  }

  // 15:00 ~ 18:00 CST
  if (m >= 15 * 60 && m < 18 * 60) {
    return {
      phase: 'APAC_POST_MARKET',
      headline: '亚太盘后定型 · 欧美盘前博弈窗口',
      window: '15:00 ~ 18:00 CST',
    };
  }

  // 18:00 ~ 美股开盘 (21:30 / 22:30) CST
  if (m >= 18 * 60 && m < usOpenMinutes) {
    return {
      phase: 'US_PRE_MARKET',
      headline: '美股盘前博弈 · 费半期货先导定价',
      window: `18:00 ~ ${usOpenLabel} CST`,
    };
  }

  // 美股开盘 ~ 美股收盘 (21:30 ~ 04:00 CST)
  if (m >= usOpenMinutes || m < usCloseMinutes) {
    return {
      phase: 'US_TRADING',
      headline: '美股主力交易 · 全球AI算力核心定价',
      window: `${usOpenLabel} ~ ${usCloseLabel} CST`,
    };
  }

  // 04:00 ~ 08:00 CST
  return {
    phase: 'GLOBAL_OVERNIGHT',
    headline: '美股隔夜结算 · 亚太盘前准备窗口',
    window: `${usCloseLabel} ~ 08:00 CST`,
  };
}

/**
 * 组合计算当前实时的 Market Clock 列表
 * 
 * @param fallbackItems 静态 JSON 中备份的 marketClock 列表
 * @param benchmarks 最新每小时拉取的 benchmarks 行情数据
 * @param currentDate 允许传入特定时间（用于测试/脱机模拟）
 */
export function resolveMarketClock(
  fallbackItems: MarketClockItem[] = [],
  benchmarks?: {
    star50?: BenchmarkQuote;
    kospi?: BenchmarkQuote;
    sox?: BenchmarkQuote;
  },
  currentDate: Date = new Date()
): {
  tradingPhase: TradingPhase;
  marketClock: MarketClockItem[];
} {
  const bj = getBeijingTime(currentDate);
  const isDst = isUSDaylightSaving(currentDate);

  const star50Status = getStar50Status(bj);
  const kospiStatus = getKospiStatus(bj);
  const soxStatus = getSoxStatus(bj, isDst);
  const tradingPhase = getTradingPhase(bj, isDst);

  // 映射 symbol 状态
  const statusMap: Record<string, { status: MarketStatus; statusLabel: string }> = {
    '000688.SS': star50Status,
    '^KS11': kospiStatus,
    '^SOX': soxStatus,
  };

  // 映射 benchmarks 最新价格与涨跌幅
  const quoteMap: Record<string, BenchmarkQuote | undefined> = {
    '000688.SS': benchmarks?.star50,
    '^KS11': benchmarks?.kospi,
    '^SOX': benchmarks?.sox,
  };

  const marketClock: MarketClockItem[] = fallbackItems.map((item) => {
    const dynStatus = statusMap[item.symbol];
    const liveQuote = quoteMap[item.symbol];

    const price = liveQuote?.price ?? item.price;
    const chg = liveQuote?.chg ?? item.chg;
    let chgClass = liveQuote?.chgClass ?? item.chgClass;
    if (!chgClass && typeof chg === 'string') {
      if (chg.startsWith('+')) chgClass = 'up';
      else if (chg.startsWith('-')) chgClass = 'down';
    }

    return {
      ...item,
      status: dynStatus ? dynStatus.status : item.status,
      statusLabel: dynStatus ? dynStatus.statusLabel : item.statusLabel,
      price,
      chg,
      chgClass,
    };
  });

  return {
    tradingPhase,
    marketClock,
  };
}
