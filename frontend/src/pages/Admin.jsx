import AsciiBox from '../components/AsciiBox';

export default function Admin() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 60px' }}>
      <div className="scanlines" />
      <div className="vignette" />
      <div style={{ width: '100%', maxWidth: 700 }}>
        <AsciiBox title="ADMIN PANEL">
          <div style={{ color: '#2A6A9A', textAlign: 'center', padding: '20px 0' }}>
            [ ADMIN PANEL — COMING SOON ]
          </div>
        </AsciiBox>
      </div>
    </div>
  );
}
