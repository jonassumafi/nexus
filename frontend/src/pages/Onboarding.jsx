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

// Shared styles — token-aligned. Inputs/selects/textareas share the .inp recipe
// (dark inset, rim0 border, rim2 on focus). Buttons share the .btn pressable
// recipe (gradient fill, 3px hard under-edge, 3px travel on :active).
const S = {
  input: {
    display: 'block',
    width: '100%',
    background: '#02080e',
    border: '1px solid var(--rim0)',
    color: 'var(--fg0)',
    fontFamily: 'var(--font)',
    fontSize: 14,
    padding: '9px 11px',
    outline: 'none',
    borderRadius: 5,
    boxShadow: '0 2px 6px #000 inset',
    boxSizing: 'border-box',
  },
  select: {
    display: 'block',
    width: '100%',
    background: '#02080e',
    border: '1px solid var(--rim0)',
    color: 'var(--fg0)',
    fontFamily: 'var(--font)',
    fontSize: 14,
    padding: '9px 11px',
    outline: 'none',
    borderRadius: 5,
    boxShadow: '0 2px 6px #000 inset',
    boxSizing: 'border-box',
    appearance: 'none',
    WebkitAppearance: 'none',
    cursor: 'pointer',
  },
  textarea: {
    display: 'block',
    width: '100%',
    background: '#02080e',
    border: '1px solid var(--rim0)',
    color: 'var(--fg0)',
    fontFamily: 'var(--font)',
    fontSize: 14,
    padding: '10px 11px',
    outline: 'none',
    resize: 'vertical',
    borderRadius: 5,
    boxShadow: '0 2px 6px #000 inset',
    boxSizing: 'border-box',
    lineHeight: 1.6,
  },
  label: {
    display: 'block',
    color: 'var(--fg2)',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.03em',
    marginBottom: 6,
    marginTop: 18,
    textTransform: 'uppercase',
  },
  // btn is now a plain object getter; actual visuals come from the .btn
  // class via className. Returning minimal inline overrides for size/variant.
  btn: (disabled = false, variant = 'default') => ({
    fontSize: 14,
    padding: '10px 22px',
    opacity: disabled ? 0.5 : 1,
    pointerEvents: disabled ? 'none' : 'auto',
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%',
  }),
  btnClass: (variant = 'default') => `btn ${variant === 'go' ? 'go' : variant === 'warn' ? 'warn' : ''}`.trim(),
  h1: { color: 'var(--fg0)', fontSize: 20, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 9, textTransform: 'uppercase' },
  h2: { color: 'var(--blue)', fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', marginBottom: 28, textTransform: 'uppercase' },
  body: { color: 'var(--fg1)', fontSize: 14, lineHeight: 1.8 },
  dimLine: { color: 'var(--fg3)', fontSize: 14, lineHeight: 2 },
  error: { color: 'var(--red)', fontSize: 13, marginTop: 14 },
  step: { color: 'var(--fg3)', fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', marginBottom: 14, textTransform: 'uppercase' },
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
      <div style={{
        color: 'var(--fg3)', fontSize: 11, fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        color: 'var(--fg0)', fontSize: 14,
        borderBottom: '1px solid var(--rim0)', paddingBottom: 3,
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ─── Button with hover ────────────────────────────────────────────────────────

function Btn({ children, onClick, disabled, variant }) {
  return (
    <button
      className={S.btnClass(variant)}
      disabled={disabled}
      onClick={disabled ? undefined : () => { playClick(); onClick?.(); }}
      style={S.btn(disabled, variant)}
    >
      {children}
    </button>
  );
}

function BackBtn({ onClick }) {
  return (
    <button
      className="btn"
      onClick={() => { playClick(); onClick(); }}
      style={{ width: '100%', marginTop: 10, fontSize: 13, padding: '8px 16px' }}
    >
      ← Go back
    </button>
  );
}

// ─── Screen 1: Welcome ───────────────────────────────────────────────────────

function Step1({ onNext }) {
  return (
    <>
      <div style={S.h1}>Nexus Interstellar Traffic System v1.0</div>
      <div style={S.h2}>Citizen registration</div>
      <div style={{ ...S.body, whiteSpace: 'normal', maxWidth: 600, marginBottom: 28 }}>
        <div style={{ marginBottom: 16 }}>
          You are now interfacing with the Nexus Interstellar Traffic System. To access fleet mission data and personnel files, you must complete citizen registration.
        </div>
        <div style={{ marginBottom: 16 }}>
          The registration process requires Citizens to divulge certain details about their background and life history. Criminal records are weighed but not immediately disqualifying.
        </div>
        <div>Do you wish to proceed?</div>
      </div>
      <Btn variant="go" onClick={onNext}>Initiate registration</Btn>
    </>
  );
}

// ─── Screen 2: System unlocks ─────────────────────────────────────────────────

const UNLOCKS = [
  'Crew assignment',
  'Mission participation',
  'RP rank system',
  'Ship registry access',
  'Post-mission log submission',
  'Nexus comms network',
];

function Step2({ onNext, onBack }) {
  return (
    <>
      <div style={S.h1}>Access granted — system overview</div>
      <div style={S.h2}>Registration unlocks the following privileges.</div>
      <div className="raised" style={{ padding: 14, marginBottom: 20 }}>
        {UNLOCKS.map(label => (
          <div key={label} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 0',
            borderBottom: '1px solid rgba(26,58,80,.4)',
            fontSize: 13,
          }}>
            <span style={{ color: 'var(--fg1)' }}>{label}</span>
            <span className="badge b-lime">Enabled</span>
          </div>
        ))}
      </div>
      <Btn variant="go" onClick={onNext}>Continue</Btn>
      <BackBtn onClick={onBack} />
    </>
  );
}

// ─── Screen 3: Border intake ──────────────────────────────────────────────────

function Step3({ formData, update, onNext, onBack }) {
  const valid = formData.citizen_name.trim() && formData.place_of_birth.trim() && formData.citizenship;
  return (
    <>
      <div style={S.h1}>Border intake — citizen identification</div>
      <div style={S.h2}>All fields required.</div>

      <label style={S.label}>Citizen name</label>
      <input
        className="inp"
        style={S.input}
        value={formData.citizen_name}
        placeholder="e.g. Kira Valdyn"
        onChange={e => update('citizen_name', e.target.value)}
      />

      <label style={S.label}>Place of birth</label>
      <input
        className="inp"
        style={S.input}
        value={formData.place_of_birth}
        placeholder="e.g. Crusader, Stanton System"
        onChange={e => update('place_of_birth', e.target.value)}
      />

      <label style={S.label}>Citizenship</label>
      <div style={{ position: 'relative' }}>
        <select
          className="inp"
          style={S.select}
          value={formData.citizenship}
          onChange={e => update('citizenship', e.target.value)}
        >
          <option value="" disabled>— Select citizenship —</option>
          <optgroup label="Stanton system">
            <option value="Hurston">Hurston</option>
            <option value="Crusader">Crusader</option>
            <option value="ArcCorp">ArcCorp</option>
            <option value="microTech">microTech</option>
          </optgroup>
          <optgroup label="Pyro system">
            <option value="Pyro I">Pyro I</option>
            <option value="Monox (Pyro II)">Monox (Pyro II)</option>
            <option value="Bloom (Pyro III)">Bloom (Pyro III)</option>
            <option value="Pyro IV">Pyro IV</option>
            <option value="Pyro V">Pyro V</option>
            <option value="Terminus (Pyro VI)">Terminus (Pyro VI)</option>
          </optgroup>
          <optgroup label="Other">
            <option value="Freeborn (No Planetary Citizenship)">Freeborn (no planetary citizenship)</option>
            <option value="Outsider (Stateless)">Outsider (stateless)</option>
            <option value="Unknown / Unregistered">Unknown / unregistered</option>
          </optgroup>
        </select>
        <div style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--fg3)', pointerEvents: 'none', fontSize: 10,
        }}>▼</div>
      </div>

      <div style={{ marginTop: 24 }}>
        <Btn variant="go" onClick={onNext} disabled={!valid}>Submit intake</Btn>
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
      <div style={S.h1}>Citizen biography</div>
      <div style={S.h2}>Write your character's biography. Our AI will refine it.</div>

      <label style={S.label}>Citizen biography</label>
      <textarea
        className="inp"
        style={{ ...S.textarea, minHeight: 120 }}
        value={formData.biography}
        placeholder="Write your character's biography — their background, history, motivations, where they've been, what they do."
        onChange={handleChange}
      />

      <div className={`counter${atLimit ? ' bad' : ''}`} style={{ marginTop: 6, marginBottom: 20 }}>
        {wordCount} / 100 words
      </div>

      <Btn variant="go" onClick={onNext} disabled={!valid}>Confirm biography</Btn>
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
      <div style={S.h1}>Citizen portrait — AI generation</div>
      <div style={{ ...S.h2, marginBottom: 16 }}>Describe your appearance.</div>

      <textarea
        className="inp"
        style={{ ...S.textarea, minHeight: 90 }}
        value={portraitDescription}
        placeholder="Describe your physical appearance — features, clothing, expression, distinguishing marks."
        onChange={e => setPortraitDescription(e.target.value)}
        disabled={state === 'generating'}
      />

      <div style={{ marginTop: 20 }}>
        {state === 'idle' && (
          <Btn variant="go" onClick={() => { playModem(); generate(); }} disabled={!portraitDescription.trim()}>
            Generate portrait
          </Btn>
        )}

        {state === 'generating' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            color: 'var(--fg2)', fontSize: 13,
          }}>
            <span className="spinner" />
            Generating portrait {dotStr}
          </div>
        )}

        {state === 'preview' && previewUrl && (
          <>
            <div className="raised" style={{ margin: '16px auto', padding: 10, maxWidth: 320 }}>
              <img
                src={previewUrl}
                alt="Generated portrait"
                style={{
                  width: '100%', display: 'block', borderRadius: 4,
                  border: '1px solid var(--rim0)',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn variant="go" onClick={accept}>Accept portrait</Btn>
              <Btn onClick={() => { playModem(); generate(); }} variant="secondary">Regenerate</Btn>
            </div>
          </>
        )}
      </div>

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}
      <BackBtn onClick={onBack} />
    </>
  );
}

// ─── Screen 6: ID card preview ────────────────────────────────────────────────

const CARD_FONT = "'Inter', system-ui, sans-serif";

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
      <div style={S.h1}>Citizen identification card — preview</div>

      {refining && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          color: 'var(--fg2)', fontSize: 13, marginBottom: 12, fontFamily: CARD_FONT,
        }}>
          <span className="spinner" />Refining biography {dotStr}
        </div>
      )}

      {/* Card — pure CSS, no background image */}
      <div style={{ maxWidth: 700, margin: '0 auto 24px', width: '100%', fontFamily: CARD_FONT }}>
        <div style={{
          /* Textured parchment image — matches IdCardModal in Dashboard
             so the preview card here and the final dossier look identical. */
          backgroundImage: 'url(/images/id_card_parchment.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: '#F0E6CD',
          border: '1px solid #2A5A7A',
          boxShadow: 'inset 0 0 1px rgba(90, 70, 40, 0.25), 0 20px 50px rgba(0, 0, 0, .4)',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            top: 110, left: '50%',
            transform: 'translateX(-50%)',
            width: 220, height: 220,
            opacity: 0.045,
            pointerEvents: 'none',
            backgroundImage:
              "radial-gradient(circle, transparent 44%, #2A3A4A 44%, #2A3A4A 46%, transparent 46%), " +
              "radial-gradient(circle, transparent 34%, #2A3A4A 34%, #2A3A4A 35%, transparent 35%)",
            backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat',
          }} />

          {/* Header */}
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid #2A5A7A',
            background: '#0A1A28',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 16, color: '#CCE8FF', fontWeight: 'bold', letterSpacing: '0.1em' }}>
                CITIZEN IDENTIFICATION CARD
              </div>
              <div style={{ fontSize: 10, color: '#66AADD', letterSpacing: '0.08em', marginTop: 3 }}>
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
                border: '1px solid #2A5A7A',
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
            borderTop: '1px solid #2A5A7A',
            background: '#0A1A28',
            fontSize: 10,
            color: '#FFBB33',
            letterSpacing: '0.05em',
          }}>
            {'P<UEE<<CITIZEN<RECORD<<<<<<<<<<<<<<<<<<<'}
          </div>
        </div>
      </div>

      <Btn variant="go" onClick={() => { playModem(); onNext(); }} disabled={refining}>Card confirmed — proceed</Btn>
      <BackBtn onClick={onBack} />
    </>
  );
}

// ─── Screen 7: Org affiliation ────────────────────────────────────────────────

function Step7({ formData, update, onNext, onBack }) {
  const valid = formData.affiliation === 'freelancer'
    || (formData.affiliation === 'org' && formData.org_invite_code.trim().length === 6);

  const optionStyle = (key) => ({
    padding: 16,
    cursor: 'pointer',
    userSelect: 'none',
    flex: 1,
    transition: 'transform .12s, border-color .12s, box-shadow .12s',
    ...(formData.affiliation === key ? {
      borderColor: 'var(--rim2)',
      boxShadow: '0 1px 0 rgba(180,225,255,.2) inset, 0 3px 0 #050e18, 0 8px 14px rgba(0,0,0,.45), 0 0 0 1px var(--rim2)',
    } : {}),
  });

  return (
    <>
      <div style={S.h1}>Declare allegiance</div>
      <div style={{ ...S.body, marginBottom: 20 }}>
        Are you affiliated with a registered organization, or do you operate independently?
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div
          className="raised"
          style={{
            ...optionStyle('org'),
            opacity: 0.55,
            cursor: 'not-allowed',
          }}
          aria-disabled="true"
        >
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
            color: 'var(--blue)', textTransform: 'uppercase', marginBottom: 6,
          }}>
            Join an organization
          </div>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
            color: 'var(--amber)', textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Unavailable — in testing
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.6 }}>
            Enter your organization's invite code to be assigned to their crew.
          </div>
        </div>

        <div
          className="raised"
          style={optionStyle('freelancer')}
          onClick={() => { playClick(); update('affiliation', 'freelancer'); }}
        >
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
            color: 'var(--blue)', textTransform: 'uppercase', marginBottom: 6,
          }}>
            Freelancer
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.6 }}>
            Register as an independent operator. You may join an organization later.
          </div>
        </div>
      </div>

      <Btn variant="go" onClick={onNext} disabled={!valid}>Declare allegiance</Btn>
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
      .then(r => setRanks(Array.isArray(r.data) && r.data.length ? r.data : FALLBACK_RANKS))
      .catch(() => setRanks(FALLBACK_RANKS))
      .finally(() => setRanksLoading(false));
  }, []);

  return (
    <>
      <div style={S.h1}>Registration complete — final briefing</div>

      <div style={{ ...S.body, marginBottom: 12 }}>
        Your rank begins at <b style={{ color: 'var(--fg0)' }}>Drifter</b>. Earn RP through missions, crew participation, and post-mission logs.
      </div>

      <div style={{ ...S.body, marginBottom: 24 }}>
        Your citizen record has been submitted to the Nexus network. Welcome to the galaxy, <b style={{ color: 'var(--fg0)' }}>{formData.citizen_name || 'operator'}</b>.
      </div>

      {/* RP Ranks table — raised card */}
      <div className="raised" style={{ marginBottom: 24, padding: '12px 14px' }}>
        <div className="h3" style={{
          display: 'flex', justifyContent: 'space-between', margin: '0 0 8px',
          borderBottom: '1px solid var(--rim0)', paddingBottom: 6,
          paddingRight: 14,
        }}>
          <span>Rank</span>
          <span>Threshold</span>
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 14 }} className="terminal-scroll">
          {ranksLoading ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--fg2)', fontSize: 13, paddingTop: 6,
            }}>
              <span className="spinner" />Loading ranks {rankDotStr}
            </div>
          ) : (
            ranks.map((r, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '5px 0',
                fontSize: 13, color: 'var(--fg1)',
                borderBottom: i < ranks.length - 1 ? '1px solid rgba(26,58,80,.4)' : 'none',
              }}>
                <span>{r.emoji} {r.title}</span>
                <span style={{ color: 'var(--fg3)', fontVariantNumeric: 'tabular-nums' }}>
                  {r.min_rp}{r.max_rp === null ? '+' : `–${r.max_rp}`}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {loading ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          color: 'var(--fg2)', fontSize: 13,
        }}>
          <span className="spinner" />Submitting record {dotStr}
        </div>
      ) : (
        <Btn variant="go" onClick={() => { playTransmit(); onSubmit(); }}>Enter Nexus</Btn>
      )}

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}
      {!loading && <BackBtn onClick={onBack} />}
    </>
  );
}

// ─── Step progress header ─────────────────────────────────────────────────────

const STEP_TITLES = [
  '',
  'Welcome',
  'System overview',
  'Border intake',
  'Biography',
  'Portrait',
  'ID card preview',
  'Allegiance',
  'Final briefing',
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

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--void)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '32px 48px',
      overflowY: 'auto',
    }}>
      <div className="vig" />

      <div style={{ width: '100%', maxWidth: 820, position: 'relative', zIndex: 1 }}>
        {/* Progress strip: step dots + section header */}
        <div className="raised" style={{ padding: '14px 18px', marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
            color: 'var(--blue)', textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Step {String(step).padStart(2, '0')} / 08 — {STEP_TITLES[step]}
          </div>
          <div className="progress"><i style={{ width: `${(step / 8) * 100}%` }} /></div>
        </div>

        {/* Step body in its own raised card */}
        <div className="raised" style={{ padding: '24px 28px', fontFamily: 'var(--font)', fontSize: 14 }}>
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
      </div>
    </div>
  );
}
