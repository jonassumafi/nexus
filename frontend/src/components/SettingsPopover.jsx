// Gear popover — radio-rig assignment entry point. Skins live under
// the dedicated palette button next to the gear.
import { AnchoredPopover } from './Banner';

export default function SettingsPopover({ anchorRef, onClose, onOpenRadioPicker }) {
  return (
    <AnchoredPopover anchorRef={anchorRef} width={260} onClose={onClose} label="Settings">
      <h4>Settings</h4>
      <div className="nxp-body">
        <button
          className="nxp-btn"
          style={{ width: '100%' }}
          onClick={() => { onClose?.(); onOpenRadioPicker?.(); }}
        >Assign radio rigs…</button>
      </div>
    </AnchoredPopover>
  );
}
