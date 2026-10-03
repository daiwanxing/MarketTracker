import { useMemo, type ReactNode } from 'react';
import { useRequest } from 'ahooks';
import { LiveQuotesContext, type LiveQuotesData } from './LiveQuotesContext';

async function fetchQuotes(): Promise<LiveQuotesData> {
  const res = await fetch('/api/quotes', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as LiveQuotesData;
  if (data && data.techSemi && data.oil && data.gold) {
    return data;
  }
  throw new Error('Incomplete quote structure');
}

export function LiveQuotesProvider({ children }: { children: ReactNode }) {
  // 盘中准实时轮询：每 12 秒安全同步一次（国内 Level-1 极速通道，边缘 CDN 缓存 8 秒）
  // 自动失焦节能（切后台暂停）、切回前台立即唤醒刷新，并在轻微网络抖动时平滑重试
  const { data: liveQuotes = null } = useRequest(fetchQuotes, {
    pollingInterval: 12000,
    pollingWhenHidden: false,
    refreshOnWindowFocus: true,
    retryCount: 3,
    onError: () => {
      // 静默降级：静态部署（如 GitHub Pages）或网络离线时不抛出阻断性错误
    },
  });

  const value = useMemo(() => ({ liveQuotes: liveQuotes ?? null }), [liveQuotes]);

  return (
    <LiveQuotesContext.Provider value={value}>
      {children}
    </LiveQuotesContext.Provider>
  );
}
