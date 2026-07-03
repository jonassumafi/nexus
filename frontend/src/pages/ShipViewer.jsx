import AsciiBox from '../components/AsciiBox';

export default function ShipViewer() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 60px' }}>
      <div className="scanlines" />
      <div className="vignette" />
      <div style={{ width: '100%', maxWidth: 700 }}>
        <AsciiBox title="SHIP VIEWER">
          <div style={{ color: '#2A6A9A', textAlign: 'center', padding: '20px 0' }}>
            [ SHIP VIEWER — COMING SOON ]
          </div>
        </AsciiBox>
      </div>
    </div>
  );
}
