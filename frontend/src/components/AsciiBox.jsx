import { useRef, useState, useEffect } from 'react';

const BORDER = '#1A3D55';

export default function AsciiBox({ children, title, fontSize = 18, charW = 11 }) {
  const containerRef = useRef(null);
  const [cols, setCols] = useState(78);

  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const w = containerRef.current.offsetWidth;
      setCols(Math.max(10, Math.floor(w / charW)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [charW]);

  const hLine = (l, m, r) => l + m.repeat(Math.max(0, cols - 2)) + r;

  const lineRow = { overflow: 'hidden', whiteSpace: 'nowrap', color: BORDER, lineHeight: 1.4 };

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace", fontSize }}
    >
      <div style={lineRow}>{hLine('╔', '═', '╗')}</div>

      {title && (
        <>
          <div style={{ padding: '3px 14px', color: '#99CCFF', letterSpacing: '0.06em', lineHeight: 1.6 }}>
            {title}
          </div>
          <div style={lineRow}>{hLine('╠', '═', '╣')}</div>
        </>
      )}

      <div style={{ padding: '30px 36px' }}>
        {children}
      </div>

      <div style={lineRow}>{hLine('╚', '═', '╝')}</div>
    </div>
  );
}
