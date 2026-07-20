import { useState } from 'react';

const LOGO = '/icons/icon-192.png';
const API_BASE = 'https://owner.nj-systems.com';
const MAX_IMAGES = 5;

// Mobile-specific overrides via a real media query — inline styles alone
// can't express "only when the screen is this narrow", so this mirrors
// the same <style> tag pattern the main landing page already uses.
const css = `
  *,*::before,*::after{box-sizing:border-box}
  .rf-card{padding:32px}
  .rf-field-row{display:flex;gap:10px}
  @media(max-width:420px){
    .rf-card{padding:22px 18px}
    .rf-field-row{flex-direction:column;gap:14px}
    .rf-title{font-size:17px!important}
    .rf-stars button{font-size:26px!important}
  }
`;

// Downscales and re-encodes a photo before it ever leaves the browser —
// a typical modern phone photo is 3-8MB, which would make 5 of them
// together a genuinely risky request size. Resizing to a sensible max
// dimension and re-encoding as JPEG at 80% quality routinely brings that
// down to a few hundred KB each, with no visible quality loss for a
// review photo, while keeping the actual upload path (base64 in the
// request body) simple — no separate upload step, no orphaned files if
// someone abandons the form partway through.
function compressImage(file, maxDim = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function Stars({ value, onChange }) {
  return (
    <div className="rf-stars" style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, fontSize: 30, lineHeight: 1, color: n <= value ? '#f59e0b' : '#e5e7eb' }}
        >★</button>
      ))}
    </div>
  );
}

export default function ReviewForm() {
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [city, setCity] = useState('');
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [email, setEmail] = useState('');
  const [avatar, setAvatar] = useState(null); // {dataUrl} or null
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [images, setImages] = useState([]); // array of {dataUrl, name}
  const [imagesBusy, setImagesBusy] = useState(false);
  const [hp, setHp] = useState(''); // honeypot — real users never see this field
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const initials = (name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();

  const pickAvatar = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setError('');
    setAvatarBusy(true);
    try {
      const dataUrl = await compressImage(file, 400, 0.85); // a profile photo doesn't need to be as large as a gallery photo
      setAvatar({ dataUrl });
    } catch {
      setError('Could not process that photo — try a different one');
    } finally {
      setAvatarBusy(false);
    }
  };

  const addImages = async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) { setError(`You can upload up to ${MAX_IMAGES} images`); return; }
    setError('');
    setImagesBusy(true);
    try {
      const toAdd = files.slice(0, remaining);
      const compressed = await Promise.all(toAdd.map(f => compressImage(f).then(dataUrl => ({ dataUrl, name: f.name }))));
      setImages(prev => [...prev, ...compressed]);
    } catch {
      setError('Could not process one of the images — try a different photo');
    } finally {
      setImagesBusy(false);
    }
  };
  const removeImage = (i) => setImages(prev => prev.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Please enter your name'); return; }
    if (!reviewText.trim()) { setError('Please write a short review'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/submit-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          businessType: businessType.trim(),
          city: city.trim(),
          rating,
          reviewText: reviewText.trim(),
          email: email.trim(),
          avatarImage: avatar ? avatar.dataUrl : null,
          images: images.map(img => img.dataUrl),
          hp,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || 'Something went wrong. Please try again.'); setSubmitting(false); return; }
      setDone(true);
    } catch {
      setError('Could not connect. Please check your internet and try again.');
      setSubmitting(false);
    }
  };

  const inputStyle = { width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit', background: '#f9fafb' };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, display: 'block' };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{css}</style>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24, textDecoration: 'none' }}>
          <img src={LOGO} alt="NJ POS" style={{ width: 32, height: 32, borderRadius: 8 }} />
          <span style={{ fontFamily: "'Michroma',sans-serif", fontSize: 16, letterSpacing: 0.5 }}>
            <span style={{ color: '#2563EB' }}>NJ</span><span style={{ color: '#111' }}>POS</span>
          </span>
        </a>

        <div className="rf-card" style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🙏</div>
              <div style={{ fontWeight: 800, fontSize: 19, marginBottom: 8 }}>Salamat po!</div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>Thank you for sharing your experience. We really appreciate it.</div>
            </div>
          ) : (
            <>
              <div className="rf-title" style={{ fontWeight: 800, fontSize: 19, marginBottom: 4, textAlign: 'center' }}>Share Your Experience</div>
              <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20, textAlign: 'center' }}>Tell other store owners what using NJ POS has been like for your business.</div>

              <form onSubmit={submit}>
                {/* Profile photo — optional, purely a visual touch on the
                    testimonial card. Falls back to initials on a colored
                    circle if never set, same as the existing cards.
                    Solid border, not dashed — a dashed border on a true
                    circle renders as a jagged/scalloped ring instead of a
                    clean dashed line, since each dash segment is straight
                    while the path it's following is curved. */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                  <label style={{ position: 'relative', cursor: avatarBusy ? 'not-allowed' : 'pointer', display: 'block' }}>
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: avatar ? 'transparent' : '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '2px solid #e5e7eb' }}>
                      {avatar ? (
                        <img src={avatar.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ color: '#fff', fontSize: 20, fontWeight: 800 }}>{initials}</span>
                      )}
                    </div>
                    <div style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: '50%', background: '#2563EB', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="ti ti-camera" style={{ fontSize: 11, color: '#fff' }} aria-hidden="true"/>
                    </div>
                    <input id="rf-avatar" name="avatar" type="file" accept="image/*" disabled={avatarBusy} onChange={e => { pickAvatar(e.target.files[0]); e.target.value = ''; }} style={{ display: 'none' }} />
                  </label>
                </div>
                {avatar && (
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <button type="button" onClick={() => setAvatar(null)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>Remove photo</button>
                  </div>
                )}

                <div style={{ marginBottom: 16, textAlign: 'center' }}>
                  <label style={{ ...labelStyle, textAlign: 'center' }}>Your rating</label>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Stars value={rating} onChange={setRating} />
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle} htmlFor="rf-name">Your name</label>
                  <input id="rf-name" name="name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Maria A." style={inputStyle} />
                </div>

                <div className="rf-field-row" style={{ marginBottom: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={labelStyle} htmlFor="rf-business-type">Business type</label>
                    <input id="rf-business-type" name="businessType" autoComplete="organization" value={businessType} onChange={e => setBusinessType(e.target.value)} placeholder="e.g. Sari-sari Store" style={inputStyle} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label style={labelStyle} htmlFor="rf-city">City</label>
                    <input id="rf-city" name="city" autoComplete="address-level2" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Cebu City" style={inputStyle} />
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle} htmlFor="rf-review">Your review</label>
                  <textarea id="rf-review" name="reviewText" value={reviewText} onChange={e => setReviewText(e.target.value)} placeholder="What's it been like using NJ POS for your business?" rows={4} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={labelStyle}>Photos <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional, up to {MAX_IMAGES})</span></div>
                  {images.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {images.map((img, i) => (
                        <div key={i} style={{ position: 'relative', width: 64, height: 64 }}>
                          <img src={img.dataUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} />
                          <button type="button" onClick={() => removeImage(i)} aria-label="Remove image" style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#dc2626', color: '#fff', border: '2px solid #fff', cursor: 'pointer', fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {images.length < MAX_IMAGES && (
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: '1.5px dashed #d1d5db', cursor: imagesBusy ? 'not-allowed' : 'pointer', fontSize: 12.5, color: '#6b7280', fontWeight: 600 }}>
                      <i className="ti ti-camera-plus" aria-hidden="true"/>
                      {imagesBusy ? 'Processing…' : `Add photo${images.length ? 's' : ''} (${images.length}/${MAX_IMAGES})`}
                      <input id="rf-photos" name="photos" type="file" accept="image/*" multiple disabled={imagesBusy} onChange={e => { addImages(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>

                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle} htmlFor="rf-email">Email <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional — for our records only, never shown publicly)</span></label>
                  <input id="rf-email" name="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} />
                </div>

                {/* Honeypot — hidden from real users via off-screen positioning
                    (not display:none, which some bots skip filling anyway,
                    but this keeps a real screen reader from announcing it too). */}
                <input
                  id="rf-hp"
                  name="website"
                  type="text"
                  value={hp}
                  onChange={e => setHp(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
                />

                {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 14 }}>{error}</div>}

                <button type="submit" disabled={submitting} style={{ width: '100%', padding: '13px 0', background: submitting ? '#93c5fd' : '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer' }}>
                  {submitting ? 'Sending…' : 'Submit Review'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
