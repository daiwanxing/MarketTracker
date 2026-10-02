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
  };
  techSemi: {
    sox: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    star50: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    kospi: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
  };
  robot?: {
    csRobot: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    robo: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
    tsla: { name: string; symbol: string; price: number; chg: string; chgClass: string; previousClose?: number };
  };
}

export interface LiveQuotesContextValue {
  liveQuotes: LiveQuotesData | null;
  isLive: boolean;
  lastSyncedAt: Date | null;
}

export const LiveQuotesContext = createContext<LiveQuotesContextValue>({
  liveQuotes: null,
  isLive: false,
  lastSyncedAt: null,
});
