import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AsciiBox from '../components/AsciiBox';
import { useAuthContext } from '../context/AuthContext.jsx';
import api from '../services/api.js';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

const modemSound = new Audio('/sounds/modem.mp3');
const playModem = () => {
  try { modemSound.currentTime = 0; modemSound.volume = 0.8; modemSound.play(); } catch(e) {}
};

const transmitSound = new Audio('/sounds/transmitting.mp3');
const playTransmit = () => {
  try { transmitSound.currentTime = 0; transmitSound.volume = 0.8; transmitSound.play(); } catch(e) {}
};

// ─── Shared styles ───────────────────────────────────────────────────────────

const S = {
  input: {
    display: 'block',
    width: '100%',
    background: '#000',
    border: '1px solid #66AADD',
    color: '#66AADD',
    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    fontSize: 16,
    padding: '9px 15px',
    outline: 'none',
    borderRadius: 0,
    boxSizing: 'border-box',
  },
  select: {
    display: 'block',
    width: '100%',
    background: '#000',
    border: '1px solid #66AADD',
    color: '#66AADD',
    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    fontSize: 16,
    padding: '11px 15px',
    outline: 'none',
    borderRadius: 0,
    boxSizing: 'border-box',
    appearance: 'none',
    WebkitAppearance: 'none',
    cursor: 'pointer',
  },
  textarea: {
    display: 'block',
    width: '100%',
    background: '#000',
    border: '1px solid #66AADD',
    color: '#66AADD',
    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    fontSize: 16,
    padding: '12px 15px',
    outline: 'none',
    resize: 'vertical',
    borderRadius: 0,
    boxSizing: 'border-box',
  },
  label: {
    display: 'block',
    color: '#2A6A9A',
    fontSize: 17,
    letterSpacing: '0.08em',
    marginBottom: 6,
    marginTop: 21,
  },
  btn: (disabled = false, variant = 'default') => ({
    background: disabled ? 'transparent' : (variant === 'secondary' ? 'transparent' : '#000'),
    border: `1px solid ${disabled ? '#1A3D55' : '#66AADD'}`,
    color: disabled ? '#1A3D55' : '#66AADD',
    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    fontSize: 18,
    padding: '12px 30px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    borderRadius: 0,
  }),
  h1: { color: '#99CCFF', fontSize: 20, letterSpacing: '0.06em', marginBottom: 9 },
  h2: { color: '#2A6A9A', fontSize: 18, letterSpacing: '0.04em', marginBottom: 30 },
  body: { color: '#4488BB', fontSize: 20, lineHeight: 1.8 },
  dimLine: { color: '#2A6A9A', fontSize: 20, lineHeight: 2 },
  error: { color: '#FF5544', fontSize: 18, marginTop: 15 },
  step: { color: '#1A3D55', fontSize: 16, marginBottom: 16 },
};

// ─── Dot animation helper ─────────────────────────────────────────────────────

const DOT_SLOTS = 20;

function useDots(active) {
  const [pos, setPos] = useState(0);
  useEffect(() => {
    if (!active) { setPos(0); return; }
    const id = setInterval(() => setPos(p => (p + 1) % (DOT_SLOTS + 1)), 80);
    return () => clearInterval(id);
  }, [active]);
  return '[' + '.'.repeat(pos) + ' '.repeat(DOT_SLOTS - pos) + ']';
}

// ─── Word counter helper ──────────────────────────────────────────────────────

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// ─── Shared card field ────────────────────────────────────────────────────────

function CardField({ label, value }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: '#1A3D55', fontSize: 16, letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ color: '#66AADD', fontSize: 16, borderBottom: '1px solid #0D2030', paddingBottom: 2 }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ─── Button with hover ────────────────────────────────────────────────────────

function Btn({ children, onClick, disabled, variant }) {
  const [hovered, setHovered] = useState(false);
  const base = S.btn(disabled, variant);
  const hoverStyle = !disabled && hovered
    ? { background: '#66AADD', color: '#000' }
    : {};
  return (
    <button
      onClick={disabled ? undefined : () => { playClick(); onClick?.(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...base, ...hoverStyle }}
    >
      {children}
    </button>
  );
}

// ─── Back button ─────────────────────────────────────────────────────────────

function BackBtn({ onClick }) {
  return (
    <button
      onClick={() => { playClick(); onClick(); }}
      style={{
        background: '#000',
        border: '1px solid #2A6A9A',
        color: '#4488BB',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        fontSize: 16,
        letterSpacing: '0.14em',
        padding: '10px 20px',
        width: '100%',
        marginTop: 10,
        cursor: 'pointer',
      }}
    >
      [ ← GO BACK ]
    </button>
  );
}

// ─── Screen 1: Welcome ───────────────────────────────────────────────────────

function Step1({ onNext }) {
  return (
    <>
      <div style={S.h1}>NEXUS INTERSTELLAR TRAFFIC SYSTEM v1.0</div>
      <div style={S.h2}>CITIZEN REGISTRATION SYSTEM</div>
      <div style={{ ...S.body, whiteSpace: 'normal', maxWidth: 600, marginBottom: 28 }}>
        <div style={{ marginBottom: 16 }}>
          You are now interfacing with the Nexus Interstellar Traffic System. To access fleet mission data and personnel files, you must complete citizen registration.
        </div>
        <div style={{ marginBottom: 16 }}>
          The registration process requires Citizens to divulge certain details about their background and life history. Criminal records are weighed but not immediately disqualifying.
        </div>
        <div>Do you wish to proceed?</div>
      </div>
      <Btn onClick={onNext}>[ INITIATE REGISTRATION ]</Btn>
    </>
  );
}

// ─── Screen 2: System unlocks ─────────────────────────────────────────────────

const UNLOCKS = [
  ['CREW ASSIGNMENT',            'ENABLED'],
  ['MISSION PARTICIPATION',      'ENABLED'],
  ['RP RANK SYSTEM',             'ENABLED'],
  ['SHIP REGISTRY ACCESS',       'ENABLED'],
  ['POST-MISSION LOG SUBMISSION','ENABLED'],
  ['NEXUS COMMS NETWORK',        'ENABLED'],
];

function Step2({ onNext, onBack }) {
  return (
    <>
      <div style={S.h1}>ACCESS GRANTED — SYSTEM OVERVIEW</div>
      <div style={{ fontSize: 16, color: '#2A6A9A', letterSpacing: '0.06em', marginBottom: 20 }}>
        REGISTRATION UNLOCKS THE FOLLOWING SYSTEM PRIVILEGES.
      </div>
      <div style={{ marginBottom: 24 }}>
        {UNLOCKS.map(([label, val]) => (
          <div key={label} style={{ ...S.dimLine, display: 'flex', justifyContent: 'space-between' }}>
            <span>&gt; {label}</span>
            <span style={{ color: '#33DDAA' }}>{val}</span>
          </div>
        ))}
      </div>
      <Btn onClick={onNext}>[ CONTINUE ]</Btn>
      <BackBtn onClick={onBack} />
    </>
  );
}

// ─── Screen 3: Border intake ──────────────────────────────────────────────────

function Step3({ formData, update, onNext, onBack }) {
  const valid = formData.citizen_name.trim() && formData.place_of_birth.trim() && formData.citizenship;
  return (
    <>
      <div style={S.h1}>BORDER INTAKE — CITIZEN IDENTIFICATION</div>
      <div style={S.h2}>All fields required.</div>

      <label style={S.label}>CITIZEN NAME</label>
      <input
        style={S.input}
        value={formData.citizen_name}
        placeholder="e.g. Kira Valdyn"
        onChange={e => update('citizen_name', e.target.value)}
      />

      <label style={S.label}>PLACE OF BIRTH</label>
      <input
        style={S.input}
        value={formData.place_of_birth}
        placeholder="e.g. Crusader, Stanton System"
        onChange={e => update('place_of_birth', e.target.value)}
      />

      <label style={S.label}>CITIZENSHIP</label>
      <div style={{ position: 'relative' }}>
        <select
          style={S.select}
          value={formData.citizenship}
          onChange={e => update('citizenship', e.target.value)}
        >
          <option value="" disabled>-- SELECT CITIZENSHIP --</option>
          <optgroup label="STANTON SYSTEM">
            <option value="Hurston">Hurston</option>
            <option value="Crusader">Crusader</option>
            <option value="ArcCorp">ArcCorp</option>
            <option value="microTech">microTech</option>
          </optgroup>
          <optgroup label="PYRO SYSTEM">
            <option value="Pyro I">Pyro I</option>
            <option value="Monox (Pyro II)">Monox (Pyro II)</option>
            <option value="Bloom (Pyro III)">Bloom (Pyro III)</option>
            <option value="Pyro IV">Pyro IV</option>
            <option value="Pyro V">Pyro V</option>
            <option value="Terminus (Pyro VI)">Terminus (Pyro VI)</option>
          </optgroup>
          <optgroup label="OTHER">
            <option value="Freeborn (No Planetary Citizenship)">Freeborn (No Planetary Citizenship)</option>
            <option value="Outsider (Stateless)">Outsider (Stateless)</option>
            <option value="Unknown / Unregistered">Unknown / Unregistered</option>
          </optgroup>
        </select>
        <div style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          color: '#2A6A9A', pointerEvents: 'none', fontSize: 16,
        }}>▼</div>
      </div>

      <div style={{ marginTop: 24 }}>
        <Btn onClick={onNext} disabled={!valid}>[ SUBMIT INTAKE ]</Btn>
        <BackBtn onClick={onBack} />
      </div>
    </>
  );
}

// ─── Screen 4: Character description ─────────────────────────────────────────

function Step4({ formData, update, onNext, onBack }) {
  const wordCount = countWords(formData.biography);
  const atLimit = wordCount >= 100;
  const valid = wordCount >= 1;

  const handleChange = (e) => {
    const val = e.target.value;
    if (countWords(val) > 100) return;
    update('biography', val);
  };

  return (
    <>
      <div style={S.h1}>CITIZEN BIOGRAPHY</div>
      <div style={S.h2}>WRITE YOUR CHARACTER'S BIOGRAPHY. OUR AI WILL REFINE IT.</div>

      <label style={S.label}>CITIZEN BIOGRAPHY</label>
      <textarea
        style={{ ...S.textarea, minHeight: 120 }}
        value={formData.biography}
        placeholder="Write your character's biography — their background, history, motivations, where they've been, what they do."
        onChange={handleChange}
      />

      <div style={{ fontSize: 16, marginTop: 6, marginBottom: 20, color: atLimit ? '#FF5544' : '#1A3D55' }}>
        {wordCount} / 100 words
      </div>

      <Btn onClick={onNext} disabled={!valid}>[ CONFIRM BIOGRAPHY ]</Btn>
      <BackBtn onClick={onBack} />
    </>
  );
}

// ─── Screen 5: Portrait generation ───────────────────────────────────────────

function Step5({ formData, update, onNext, onBack, portraitDescription, setPortraitDescription }) {
  const [state, setState]           = useState('idle');
  const [previewUrl, setPreviewUrl] = useState(formData.portrait_url || '');
  const [error, setError]           = useState('');
  const dotStr = useDots(state === 'generating');

  const generate = async () => {
    if (!portraitDescription.trim()) return;
    setState('generating');
    setError('');
    try {
      const res = await api.post('/users/generate-portrait', { description: portraitDescription });
      setPreviewUrl(res.data.portrait_url);
      setState('preview');
    } catch (err) {
      setError(err.response?.data?.error || 'Portrait generation failed');
      setState('idle');
    }
  };

  const accept = () => {
    update('portrait_url', previewUrl);
    onNext();
  };

  return (
    <>
      <div style={S.h1}>CITIZEN PORTRAIT — AI GENERATION</div>
      <div style={{ ...S.h2, marginBottom: 16 }}>
        DESCRIBE YOUR APPEARANCE
      </div>

      <textarea
        style={{ ...S.textarea, minHeight: 90 }}
        value={portraitDescription}
        placeholder="Describe your physical appearance — features, clothing, expression, distinguishing marks."
        onChange={e => setPortraitDescription(e.target.value)}
        disabled={state === 'generating'}
      />

      <div style={{ marginTop: 20 }}>
        {state === 'idle' && (
          <Btn onClick={() => { playModem(); generate(); }} disabled={!portraitDescription.trim()}>[ GENERATE PORTRAIT ]</Btn>
        )}

        {state === 'generating' && (
          <div style={{ color: '#66AADD', fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace", fontSize: 16 }}>
            GENERATING PORTRAIT {dotStr}
          </div>
        )}

        {state === 'preview' && previewUrl && (
          <>
            <div style={{ margin: '16px auto', textAlign: 'center' }}>
              <img
                src={previewUrl}
                alt="Generated portrait"
                style={{ maxWidth: 300, border: '1px solid #66AADD', display: 'block', margin: '0 auto 16px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Btn onClick={accept}>[ ACCEPT PORTRAIT ]</Btn>
              <Btn onClick={() => { playModem(); generate(); }} variant="secondary">[ REGENERATE ]</Btn>
            </div>
          </>
        )}
      </div>

      {error && <div style={S.error}>{error}</div>}
      <BackBtn onClick={onBack} />
    </>
  );
}

// ─── Screen 6: ID card preview ────────────────────────────────────────────────

const CARD_FONT = "'JetBrains Mono', 'Courier New', Courier, monospace";

function genDocNo(user) {
  const src = user?._id || user?.discord_id || '';
  if (src.length >= 8) {
    const clean = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '0').padEnd(4, '0');
    return `NTS-${clean(src.slice(-8, -4))}-${clean(src.slice(-4))}`;
  }
  const r = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NTS-${r()}-${r()}`;
}

function Step6({ formData, update, user, onNext, onBack }) {
  const [refining, setRefining] = useState(false);
  const dotStr = useDots(refining);
  const [docNo] = useState(() => genDocNo(user));

  useEffect(() => {
    if (formData.refinedBiography) return;
    setRefining(true);
    api.post('/users/refine-biography', { raw_biography: formData.biography })
      .then(res => {
        update('refinedBiography', res.data.refined_biography || formData.biography);
      })
      .catch(() => {
        update('refinedBiography', formData.biography);
      })
      .finally(() => setRefining(false));
  }, []);

  const rpRank = user?.rp_rank?.title || 'Drifter';
  const regDate = new Date().toISOString().split('T')[0];

  return (
    <>
      <div style={S.h1}>CITIZEN IDENTIFICATION CARD — PREVIEW</div>

      {refining && (
        <div style={{ color: '#2A6A9A', fontSize: 16, marginBottom: 12, fontFamily: CARD_FONT }}>
          REFINING BIOGRAPHY {dotStr}
        </div>
      )}

      {/* Card — pure CSS, no background image */}
      <div style={{ maxWidth: 700, margin: '0 auto 24px', width: '100%', fontFamily: CARD_FONT }}>
        <div style={{ background: '#FFFFFF', border: '1px solid #2A6A9A' }}>

          {/* Header */}
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid #2A6A9A',
            background: '#F0F6FA',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 16, color: '#0D1A24', fontWeight: 'bold', letterSpacing: '0.1em' }}>
                CITIZEN IDENTIFICATION CARD
              </div>
              <div style={{ fontSize: 10, color: '#2A3A4A', letterSpacing: '0.08em', marginTop: 3 }}>
                FORM UEE-CIT-001 · OFFICIAL GOVERNMENT DOCUMENT
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* UEE Seal — pure CSS, two concentric circles */}
              <div style={{
                width: 32, height: 32,
                border: '1px solid #FFBB33',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <div style={{
                  width: 22, height: 22,
                  border: '1px solid #FFBB33',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: '#FFBB33', fontWeight: 'bold', letterSpacing: '0.02em',
                }}>
                  UEE
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#FFBB33', letterSpacing: '0.1em', fontWeight: 'bold' }}>
                UNITED EMPIRE OF EARTH
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', gap: 24, padding: 24 }}>

            {/* Portrait column */}
            <div style={{ width: '30%' }}>
              <div style={{
                width: '100%',
                aspectRatio: '3/4',
                border: '1px solid #2A6A9A',
                background: '#1A3A50',
                overflow: 'hidden',
              }}>
                {formData.portrait_url && (
                  <img
                    src={formData.portrait_url}
                    alt="Portrait"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
              </div>
              <div style={{ fontSize: 10, color: '#FFBB33', marginTop: 10, letterSpacing: '0.08em', fontWeight: 'bold' }}>
                DOC NO. {docNo}
              </div>
            </div>

            {/* Data column */}
            <div style={{ width: '70%', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { label: 'NAME',           value: formData.citizen_name },
                { label: 'PLACE OF BIRTH', value: formData.place_of_birth },
                { label: 'CITIZENSHIP',    value: formData.citizenship },
                { label: 'RP RANK',        value: rpRank },
                { label: 'REG. DATE',      value: regDate },
              ].map((field, i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, color: '#2A3A4A', letterSpacing: '0.12em', marginBottom: 4, fontWeight: 'bold' }}>
                    {field.label}
                  </div>
                  <div style={{ fontSize: 17, color: '#0D1A24', fontWeight: 'bold', letterSpacing: '0.04em' }}>
                    {field.value || '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 20px',
            borderTop: '1px solid #2A6A9A',
            background: '#F0F6FA',
            fontSize: 10,
            color: '#FFBB33',
            letterSpacing: '0.05em',
          }}>
            {'P<UEE<<CITIZEN<RECORD<<<<<<<<<<<<<<<<<<<'}
          </div>
        </div>
      </div>

      <Btn onClick={() => { playModem(); onNext(); }} disabled={refining}>[ CARD CONFIRMED — PROCEED ]</Btn>
      <BackBtn onClick={onBack} />
    </>
  );
}

// ─── Screen 7: Org affiliation ────────────────────────────────────────────────

function Step7({ formData, update, onNext, onBack }) {
  const valid = formData.affiliation === 'freelancer'
    || (formData.affiliation === 'org' && formData.org_invite_code.trim().length === 6);

  const optionStyle = (key) => ({
    border: `1px solid ${formData.affiliation === key ? '#00EEFF' : '#1A3D55'}`,
    padding: 16,
    cursor: 'pointer',
    color: formData.affiliation === key ? '#66AADD' : '#2A6A9A',
    userSelect: 'none',
    flex: 1,
  });

  return (
    <>
      <div style={S.h1}>DECLARE ALLEGIANCE</div>
      <div style={{ ...S.body, marginBottom: 20 }}>
        Are you affiliated with a registered organization, or do you operate independently?
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={optionStyle('org')} onClick={() => { playClick(); update('affiliation', 'org'); }}>
          <div style={{ color: '#99CCFF', marginBottom: 8, fontSize: 16 }}>[A] JOIN AN ORGANIZATION</div>
          <div style={{ fontSize: 16, marginBottom: 12 }}>
            Enter your organization's invite code to be assigned to their crew.
          </div>
          {formData.affiliation === 'org' && (
            <div onClick={e => e.stopPropagation()}>
              <label style={{ ...S.label, marginTop: 0 }}>INVITE CODE</label>
              <input
                style={{ ...S.input, textTransform: 'uppercase', letterSpacing: '0.2em' }}
                value={formData.org_invite_code}
                onChange={e => update('org_invite_code', e.target.value.toUpperCase().slice(0, 6))}
                placeholder="XXXXXX"
                maxLength={6}
              />
            </div>
          )}
        </div>

        <div style={optionStyle('freelancer')} onClick={() => { playClick(); update('affiliation', 'freelancer'); }}>
          <div style={{ color: '#99CCFF', marginBottom: 8, fontSize: 16 }}>[B] FREELANCER</div>
          <div style={{ fontSize: 16 }}>
            Register as an independent operator. You may join an organization later.
          </div>
        </div>
      </div>

      <Btn onClick={onNext} disabled={!valid}>[ DECLARE ALLEGIANCE ]</Btn>
      <BackBtn onClick={onBack} />
    </>
  );
}

// ─── Screen 8: Final summary + submit ─────────────────────────────────────────

const FALLBACK_RANKS = [
  { min_rp: 0,    max_rp: 49,   title: 'Drifter',               emoji: '🕶️' },
  { min_rp: 50,   max_rp: 149,  title: 'Signal-Seeker',         emoji: '📡' },
  { min_rp: 150,  max_rp: 249,  title: 'Initiate',              emoji: '🧬' },
  { min_rp: 250,  max_rp: 349,  title: 'Surveyor',              emoji: '🧭' },
  { min_rp: 350,  max_rp: 449,  title: 'Pathbreaker',           emoji: '🛠️' },
  { min_rp: 450,  max_rp: 599,  title: 'Flight Officer',        emoji: '🔫' },
  { min_rp: 600,  max_rp: 749,  title: 'Senior Flight Officer', emoji: '🦺' },
  { min_rp: 750,  max_rp: 899,  title: 'Continuum Navigator',   emoji: '🧭' },
  { min_rp: 900,  max_rp: 1099, title: 'Detachment Marshal',    emoji: '📋' },
  { min_rp: 1100, max_rp: 1499, title: 'Fleet Marshal',         emoji: '🎖️' },
  { min_rp: 1500, max_rp: 1799, title: 'Principal',             emoji: '🛡️' },
  { min_rp: 1800, max_rp: 2399, title: 'Vanguard Commander',    emoji: '⚔️' },
  { min_rp: 2400, max_rp: null, title: 'Hopewell Steward',      emoji: '🕊️' },
];

function Step8({ formData, user, onSubmit, loading, error, onBack }) {
  const [ranks, setRanks]             = useState([]);
  const [ranksLoading, setRanksLoading] = useState(true);
  const dotStr      = useDots(loading);
  const rankDotStr  = useDots(ranksLoading);

  useEffect(() => {
    api.get('/rp/ranks')
      .then(r => setRanks(r.data))
      .catch(() => setRanks(FALLBACK_RANKS))
      .finally(() => setRanksLoading(false));
  }, []);

  return (
    <>
      <div style={S.h1}>REGISTRATION COMPLETE — FINAL BRIEFING</div>

      {/* Paragraph 1 */}
      <div style={{ ...S.body, marginBottom: 12 }}>
        Your rank begins at DRIFTER. Earn RP through missions, crew participation, and post-mission logs.
      </div>

      {/* Paragraph 2 */}
      <div style={{ ...S.body, marginBottom: 24 }}>
        Your citizen record has been submitted to the Nexus network. Welcome to the galaxy, {formData.citizen_name || 'operator'}.
      </div>

      {/* RP Ranks table */}
      <div style={{ marginBottom: 24, maxHeight: 220, overflowY: 'auto' }} className="terminal-scroll">
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          color: '#99CCFF', fontSize: 16, paddingBottom: 4,
          borderBottom: '1px solid #1A3D55', marginBottom: 4,
        }}>
          <span>RANK</span>
          <span>THRESHOLD</span>
        </div>

        {ranksLoading ? (
          <div style={{ color: '#2A6A9A', fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace", fontSize: 16, paddingTop: 8 }}>
            LOADING RANKS {rankDotStr}
          </div>
        ) : (
          ranks.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', ...S.dimLine, lineHeight: 1.7 }}>
              <span>{r.emoji} {r.title}</span>
              <span style={{ color: '#66AADD' }}>
                {r.min_rp}{r.max_rp === null ? '+' : `–${r.max_rp}`}
              </span>
            </div>
          ))
        )}
      </div>

      {loading ? (
        <div style={{ color: '#66AADD', fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace", fontSize: 16 }}>
          SUBMITTING RECORD {dotStr}
        </div>
      ) : (
        <Btn onClick={() => { playTransmit(); onSubmit(); }}>[ ENTER NEXUS ]</Btn>
      )}

      {error && <div style={S.error}>{error}</div>}
      {!loading && <BackBtn onClick={onBack} />}
    </>
  );
}

// ─── Step progress header ─────────────────────────────────────────────────────

const STEP_TITLES = [
  '',
  'WELCOME',
  'SYSTEM OVERVIEW',
  'BORDER INTAKE',
  'BIOGRAPHY',
  'PORTRAIT',
  'ID CARD PREVIEW',
  'ALLEGIANCE',
  'FINAL BRIEFING',
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function Onboarding() {
  const { user, login } = useAuthContext();
  const navigate = useNavigate();

  const [step, setStep]         = useState(1);
  const [loading, setLoading]   = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [portraitDescription, setPortraitDescription] = useState('');
  const [formData, setFormData] = useState({
    citizen_name:         '',
    place_of_birth:       '',
    citizenship:          '',
    biography:            '',
    refinedBiography:     '',
    portrait_description: '',
    portrait_url:         '',
    affiliation:          null,
    org_invite_code:      '',
  });

  useEffect(() => {
    if (user?.onboarding_complete) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const update = (key, value) =>
    setFormData(prev => ({ ...prev, [key]: value }));

  const next = () => setStep(s => s + 1);
  const back = () => setStep(s => s - 1);
  const backFrom6 = () => { update('refinedBiography', ''); setStep(s => s - 1); };

  const handleSubmit = async () => {
    setLoading(true);
    setSubmitError('');
    try {
      const payload = {
        citizen_name:   formData.citizen_name,
        place_of_birth: formData.place_of_birth,
        citizenship:    formData.citizenship,
        biography:      formData.refinedBiography || formData.biography,
        portrait_url:   formData.portrait_url || undefined,
      };
      if (formData.affiliation === 'org') {
        payload.org_invite_code = formData.org_invite_code;
      }

      const res = await api.post('/users/onboarding', payload);
      login(res.data.token);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Submission failed. Please retry.');
      setLoading(false);
    }
  };

  const title = `STEP ${String(step).padStart(2, '0')} / 08 — ${STEP_TITLES[step]}`;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '32px 48px',
      overflowY: 'auto',
    }}>
      <div className="scanlines" />
      <div className="vignette" />

      <div style={{ width: '100%', maxWidth: 800, position: 'relative', zIndex: 1 }}>
        <AsciiBox title={title}>
          <div style={{ fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace", fontSize: 16 }}>

            {step === 1 && <Step1 onNext={next} />}
            {step === 2 && <Step2 onNext={next} onBack={back} />}
            {step === 3 && <Step3 formData={formData} update={update} onNext={next} onBack={back} />}
            {step === 4 && <Step4 formData={formData} update={update} onNext={next} onBack={back} />}
            {step === 5 && <Step5 formData={formData} update={update} onNext={next} onBack={back} portraitDescription={portraitDescription} setPortraitDescription={setPortraitDescription} />}
            {step === 6 && <Step6 formData={formData} update={update} user={user} onNext={next} onBack={backFrom6} />}
            {step === 7 && <Step7 formData={formData} update={update} onNext={next} onBack={back} />}
            {step === 8 && (
              <Step8
                formData={formData}
                user={user}
                onSubmit={handleSubmit}
                loading={loading}
                error={submitError}
                onBack={back}
              />
            )}

          </div>
        </AsciiBox>
      </div>
    </div>
  );
}
