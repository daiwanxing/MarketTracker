import { createContext } from 'react';

export interface LiveQuotesData {
  asOf: string;
  oil: {
    price: string;
    chg: string;
    chgClass: string;
    quotes: { wti?: number; dxy?: number };
  };
  gold: {
    price: string;
    chg: string;
    chgClass: string;
    quotes: { gc?: number; dxy?: number; us10y?: number };
    benchmarks?: {
      londonSpot?: { name: string; symbol: string; price: number; chg: string; chgClass: string; unit?: string; previousClose?: number };
      comexGold?: { name: string; symbol: string; price: number; chg: string; chgClass: string; unit?: string; previousClose?: number };
      shau?: { name: string; symbol: string; price: number; chg: string; chgClass: string; unit?: string; previousClose?: number };
      shfeGold?: { name: string; symbol: string; price: number; chg: string; chgClass: string; unit?: string; previousClose?: number };
    };
    premium?: {
      spreadUsd: number;
      spreadRmb: number;
      premiumRate: string;
      zone: 'NORMAL' | 'HOT' | 'SQUEEZE' | 'DISCOUNT';
      zoneLabel: string;
      deadband: [number, number];
      percentile: number;
      hint: string;
    };
  };
  techSemi: {
    sox: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    star50: {
      name: string;
      symbol: string;
      price: number;
      chg: string;
      chgClass: string;
      previousClose?: number;
      tradingStatus?: string;
      sessionDate?: string;
      lastCloseChg?: string;
      holidayName?: string;
    };
    kospi: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    crowding?: {
      value: number;
      tmtAmountYi: number;
      marketAmountYi: number;
      zone: string;
      label: string;
    };
  };
  robot?: {
    csRobot: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    robo: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    tsla: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    crowding?: {
      value: number;
      robotAmountYi: number;
      marketAmountYi: number;
      zone: string;
      label: string;
    };
  };
  equip?: {
    benchmark: {
      name: string;
      symbol: string;
      price: number;
      chg: string;
      chgClass: string;
      previousClose?: number;
    };
    crowding?: {
      value: number;
      equipAmountYi: number;
      marketAmountYi: number;
      zone: string;
      label: string;
    };
    leaders?: Array<{
      symbol: string;
      price: number;
      chg: string;
      chgClass: string;
      previousClose?: number;
    }>;
  };
}

export interface LiveQuotesContextValue {
  liveQuotes: LiveQuotesData | null;
}

export const LiveQuotesContext = createContext<LiveQuotesContextValue>({
  liveQuotes: null,
});
