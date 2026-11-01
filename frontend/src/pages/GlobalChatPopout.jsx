// Standalone global-chat page — loaded by the Electron popout BrowserWindow
// opened via electronAPI.chatPopout.open(). Renders the same GlobalChat
// component in "popout" mode (fills the window, exposes pin/opacity window
// controls via IPC).

import { useEffect } from 'react';
import GlobalChat from '../components/GlobalChat.jsx';

export default function GlobalChatPopout() {
  // The popout BrowserWindow is created transparent (so setOpacity
  // produces real see-through over Star Citizen). Force the html/body
  // and #root to also be transparent, otherwise their default --void
  // background would paint a solid rectangle regardless of window
  // transparency.
  useEffect(() => {
    const prev = {
      html: document.documentElement.style.background,
      body: document.body.style.background,
      root: document.getElementById('root')?.style.background,
    };
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const root = document.getElementById('root');
    if (root) root.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = prev.html;
      document.body.style.background = prev.body;
      if (root) root.style.background = prev.root;
    };
  }, []);

  return (
    <GlobalChat
      open
      mode="popout"
      onOpenChange={() => {}}
      markSeen={() => {}}
    />
  );
}
