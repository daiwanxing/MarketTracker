import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * 路由切换时自动重置滚动条至顶部
 * 解决 SPA 页面间导航保留上一页面滑动距离的缺陷
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // 禁用浏览器默认的历史滚动恢复干扰
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const resetScroll = () => {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'instant',
      });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    // 1. 立即重置
    resetScroll();

    // 2. 下一渲染帧再次确认，确保新路由组件挂载后滚动条稳定处于顶部
    const rafId = requestAnimationFrame(resetScroll);

    return () => cancelAnimationFrame(rafId);
  }, [pathname]);

  return null;
}
