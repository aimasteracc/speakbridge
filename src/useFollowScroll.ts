import { useLayoutEffect, useRef, useState } from 'react';

export function useFollowScroll(enabled: boolean, resetKey?: string) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const follow = useRef(true), frame = useRef(0), lastTop = useRef(0);
  const anchor = useRef<{ node: Element; offset: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const cancel = () => { cancelAnimationFrame(frame.current); frame.current = 0; };
  const remember = () => {
    const el = viewport.current; if (!el || !content.current) return;
    const top = el.getBoundingClientRect().top;
    const node = [...content.current.children].find(node => node.getBoundingClientRect().bottom > top);
    anchor.current = node ? { node, offset: node.getBoundingClientRect().top - top } : null;
  };
  const pause = () => { follow.current = false; setPaused(true); cancel(); remember(); };
  const move = () => {
    if (!enabled) return;
    if (!follow.current) {
      const el = viewport.current, saved = anchor.current;
      if (el && saved?.node.isConnected) {
        // Late translations above the reader must not push their passage away.
        el.scrollTop += saved.node.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset;
        lastTop.current = el.scrollTop;
      }
      return;
    }
    if (frame.current) return;
    let previous = performance.now();
    const tick = (now: number) => {
      const el = viewport.current;
      if (!el || !follow.current) { frame.current = 0; return; }
      const target = Math.max(0, el.scrollHeight - el.clientHeight), distance = target - el.scrollTop;
      const finish = Math.abs(distance) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches;
      const step = distance * (1 - Math.exp(-Math.min(64, now - previous) / 65));
      // Chromium can round sub-pixel scroll assignments to zero. Always finish.
      el.scrollTop = finish ? target : el.scrollTop + Math.sign(distance) * Math.min(Math.abs(distance), Math.max(1, Math.abs(step)));
      lastTop.current = el.scrollTop; previous = now;
      frame.current = finish ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const resume = () => { follow.current = true; anchor.current = null; setPaused(false); move(); };
  useLayoutEffect(() => {
    follow.current = true; anchor.current = null; setPaused(false); lastTop.current = viewport.current?.scrollTop || 0;
    if (!enabled) return;
    const observer = new ResizeObserver(move);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    move();
    return () => { observer.disconnect(); cancel(); };
  }, [enabled, resetKey]);
  return {
    viewport, content, paused, resume,
    onScroll: () => {
      const el = viewport.current; if (!el || !enabled) return;
      // Ignore our own scroll assignments. Re-anchoring after each fractional
      // line-height adjustment would accumulate rounding drift while streaming.
      if (Math.abs(el.scrollTop - lastTop.current) < .1) return;
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 12;
      if (atBottom && !follow.current) resume();
      else if (!atBottom && el.scrollTop < lastTop.current - 2) pause();
      lastTop.current = el.scrollTop;
      if (!follow.current) remember();
    },
    onWheel: (event: { deltaY: number }) => { if (enabled && event.deltaY < 0) pause(); },
    onKeyDown: (event: { key: string }) => { if (enabled && ['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause(); },
    onPointerDown: () => { const el = viewport.current; if (enabled && el && el.scrollHeight > el.clientHeight) pause(); },
  };
}
