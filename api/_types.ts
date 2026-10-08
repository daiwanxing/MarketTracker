export interface QuoteItem {
  name?: string;
  symbol: string;
  price: number;
  previousClose?: number;
  chg: string;
  chgClass: 'up' | 'down' | '';
}


export interface SectorCrowdingResult {
  market: {
    shAmountYi: number;
    szAmountYi: number;
    marketAmountYi: number;
  };
  techSemi: {
    tmtAmountYi: number;
    marketAmountYi: number;
    value: number;
    zone: string;
    label: string;
  };
  robot: {
    robotAmountYi: number;
    marketAmountYi: number;
    value: number;
    zone: string;
    label: string;
  };
}

export interface SinaGlobalQuotes {
  sox?: QuoteItem | null;
  kospi?: QuoteItem | null;
  star50?: QuoteItem | null;
  dxy?: number | null;
  spotGold?: QuoteItem | null;
  comexGold?: QuoteItem | null;
  shau?: QuoteItem | null;
  usdcny?: number | null;
}

export interface EastmoneyYieldResult {
  us10y?: number | null;
  us2y?: number | null;
  asOf?: string | null;
}

export interface GoldBenchmarkItem {
  name: string;
  symbol: string;
  price: number;
  chg: string;
  chgClass: 'up' | 'down' | '';
  unit?: string;
  previousClose?: number;
  src?: string;
}

export interface GoldPremiumResult {
  spreadUsd: number;
  spreadRmb: number;
  premiumRate: string;
  zone: 'NORMAL' | 'HOT' | 'SQUEEZE' | 'DISCOUNT';
  zoneLabel: string;
  deadband: [number, number];
  percentile: number;
  hint: string;
}

