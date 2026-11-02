import { memo, useLayoutEffect, useRef, useState } from 'react';
import { revealPlan, textChange } from './text-motion';

export const LiveText = memo(function LiveText({ text, animate = true, settled = false }: { text: string; animate?: boolean; settled?: boolean }) {
  const [frame, setFrame] = useState(() => ({ text: animate && !settled ? '' : text, version: 0, ...textChange('', animate && !settled ? '' : text) }));
  const current = useRef(frame);
  useLayoutEffect(() => {
    let raf = 0;
    const show = (value: string) => {
      if (current.current.text === value) return;
      const next = { text: value, version: current.current.version + 1, ...textChange(current.current.text, value) };
      current.current = next; setFrame(next);
    };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const flush = () => { cancelAnimationFrame(raf); show(text); };
    const plan = revealPlan(current.current.text, text);
    if (!animate || settled || media.matches || document.hidden || !plan || !plan.units.length) { flush(); return; }
    {
      const start = performance.now();
      show(plan.prefix + plan.units[0]);
      const tick = (now: number) => {
        const count = Math.min(plan.units.length, Math.max(1, Math.ceil((now - start) / plan.duration * plan.units.length)));
        show(plan.prefix + plan.units.slice(0, count).join(''));
        if (count < plan.units.length) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    const onMotion = () => { if (media.matches) flush(); };
    const onVisibility = () => { if (document.hidden) flush(); };
    media.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelAnimationFrame(raf); media.removeEventListener('change', onMotion); document.removeEventListener('visibilitychange', onVisibility); };
  }, [text, animate, settled]);
  if (!animate) return <>{text}</>;
  return <span className="stream-text"><span>{frame.head}</span>{frame.chunks.map((chunk, index) => <span
    key={`${frame.version}-${index}`} className={'stream-chunk ' + (frame.revised ? 'stream-revised' : '')}
  >{chunk}</span>)}<span>{frame.tail}</span></span>;
});
