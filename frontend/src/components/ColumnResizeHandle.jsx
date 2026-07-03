import { useState } from 'react';

// 8px wide grab strip overlapping the column edge. `side` selects which edge:
//   'right' — sits on the right edge (use on a LEFT column; setWidth = setLeftWidth)
//   'left'  — sits on the left edge  (use on a RIGHT column; setWidth = setRightWidth)
// During drag, renders a 1px guideline at cursor X.
export default function ColumnResizeHandle({ side, columnRef, setWidth, min = 160, max = 450 }) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cursorX, setCursorX] = useState(0);

  function onMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    setCursorX(e.clientX);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      if (!columnRef.current) return;
      const rect = columnRef.current.getBoundingClientRect();
      const w = side === 'right'
        ? ev.clientX - rect.left
        : rect.right - ev.clientX;
      setWidth(Math.max(min, Math.min(max, w)));
      setCursorX(ev.clientX);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragging(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <>
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'absolute',
          [side]: -4,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: 'col-resize',
          zIndex: 10,
          background: hover || dragging ? 'rgba(102,170,221,0.2)' : 'transparent',
        }}
      />
      {dragging && (
        <div style={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          width: 1,
          background: '#66AADD',
          pointerEvents: 'none',
          zIndex: 100,
          left: cursorX,
        }} />
      )}
    </>
  );
}
