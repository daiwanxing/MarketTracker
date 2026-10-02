import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { LiveQuotesContext, type LiveQuotesData } from './LiveQuotesContext';

export function LiveQuotesProvider({ children }: { children: ReactNode }) {
  const [liveQuotes, setLiveQuotes] = useState<LiveQuotesData | null>(null);

  useEffect(() => {
    let active = true;

    async function syncQuotes() {
      // 页面隐藏时（切到后台标签页），暂停请求以节省网络与边缘资源
      if (typeof document !== 'undefined' && document.hidden) return;

      try {
        const res = await fetch('/api/quotes', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const data = (await res.json()) as LiveQuotesData;
        if (active && data && data.techSemi && data.oil && data.gold) {
          setLiveQuotes(data);
        }
      } catch {
        // 静默降级：静态部署（如 GitHub Pages）或网络离线时不抛出阻断性错误
      }
    }

    // 初次挂载立即触发同步
    syncQuotes();

    // 盘中准实时轮询：每 12 秒安全同步一次（国内 Level-1 极速通道，边缘 CDN 缓存 8 秒）
    const interval = setInterval(syncQuotes, 12000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const value = useMemo(() => ({ liveQuotes }), [liveQuotes]);

  return (
    <LiveQuotesContext.Provider value={value}>
      {children}
    </LiveQuotesContext.Provider>
  );
}
