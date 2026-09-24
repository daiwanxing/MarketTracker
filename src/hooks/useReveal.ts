import { useEffect, useRef } from 'react';

/**
 * 滚动渐显（SpaceX token 的克制入场动效）
 * 对容器内 .node / .rcard / .nrow 元素做 IntersectionObserver 渐显。
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;
    const targets = el.querySelectorAll<HTMLElement>('.node, .rcard, .nrow');
    if (!targets.length) return;
    targets.forEach((t, i) => {
      t.dataset.i = String(i);
      t.classList.add('pre');
    });
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
        if (!hit.length) return;
        hit.sort((a, b) => (Number(a.dataset.i) || 0) - (Number(b.dataset.i) || 0));
        hit.forEach((t, idx) => {
          t.style.transitionDelay = idx * 0.06 + 's';
          t.classList.add('in');
          io.unobserve(t);
        });
      },
      { threshold: 0.08 }
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return ref;
}
