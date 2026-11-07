// Gear popover — radio-rig assignment entry points for both tuners.
// Skins live under the dedicated palette button next to the gear.
import { AnchoredPopover } from './Banner';

export default function SettingsPopover({ anchorRef, onClose, onOpenRadioPicker, onOpenCommandRadioPicker }) {
  return (
    <AnchoredPopover anchorRef={anchorRef} width={260} onClose={onClose} label="Settings">
      <h4>Settings</h4>
      <div className="nxp-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          className="nxp-btn"
          style={{ width: '100%' }}
          onClick={() => { onClose?.(); onOpenRadioPicker?.(); }}
        >Crew radio rig…</button>
        {onOpenCommandRadioPicker && (
          <button
            className="nxp-btn"
            style={{ width: '100%' }}
            onClick={() => { onClose?.(); onOpenCommandRadioPicker?.(); }}
          >Command radio rig…</button>
        )}
      </div>
    </AnchoredPopover>
  );
}
