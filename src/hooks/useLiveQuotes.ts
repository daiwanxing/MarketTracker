import { useContext } from 'react';
import { LiveQuotesContext } from '../context/LiveQuotesContext';

export function useLiveQuotes() {
  return useContext(LiveQuotesContext);
}
