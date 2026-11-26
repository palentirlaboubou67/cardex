// Caméra arrière 1080p : mise au point continue, zoom 1,5–2× si disponible (on recule le téléphone, la carte
// reste nette et grande dans l'image), lampe avec notre propre état (iOS relit mal getSettings().torch).
// Les dimensions du flux se lisent à chaque image (video.videoWidth/Height) : le flux est souvent tourné (portrait).

let cur = null;   // { stream, track, video, torch, zoom }
let gen = 0;      // incrémenté par closeCamera() : une ouverture en cours devenue inutile est abandonnée

// Erreur typée pour l'interface : kind = insecure | unsupported | denied | nocamera | busy | aborted | unknown
export class CameraError extends Error {
  constructor(kind, message) { super(message); this.name = 'CameraError'; this.kind = kind; }
}

const MESSAGES = {
  insecure: 'La caméra demande une connexion sécurisée (https)',
  unsupported: 'Ce navigateur ne donne pas accès à la caméra',
  denied: 'Accès à la caméra refusé',
  nocamera: 'Aucune caméra trouvée',
  busy: 'La caméra est utilisée par une autre application',
  aborted: 'Ouverture de la caméra annulée',
  unknown: 'Impossible d’ouvrir la caméra',
};

function typed(e) {
  const kind = {
    NotAllowedError: 'denied', PermissionDeniedError: 'denied', SecurityError: 'insecure',
    NotFoundError: 'nocamera', DevicesNotFoundError: 'nocamera', OverconstrainedError: 'nocamera',
    NotReadableError: 'busy', TrackStartError: 'busy', AbortError: 'busy',
  }[e?.name] || 'unknown';
  return new CameraError(kind, MESSAGES[kind]);
}

// opts.video : contraintes supplémentaires (tests : fausse caméra en portrait)
export async function openCamera(video, opts = {}) {
  if (globalThis.isSecureContext === false) throw new CameraError('insecure', MESSAGES.insecure);
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported', MESSAGES.unsupported);
  closeCamera();
  const my = gen;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 },
        ...(opts.video || {}),
      },
    });
  } catch (e) {
    throw typed(e);
  }
  // la vue a été quittée pendant la demande d'autorisation : on rend la caméra tout de suite
  const abandon = () => { if (my === gen) return false; for (const t of stream.getTracks()) t.stop(); return true; };
  if (abandon()) throw new CameraError('aborted', MESSAGES.aborted);
  const track = stream.getVideoTracks()[0];
  const caps = (track && track.getCapabilities && track.getCapabilities()) || {};
  // réglages appliqués un par un : un refus (zoom) ne doit pas annuler l'autre (mise au point)
  const apply = async c => { try { await track.applyConstraints({ advanced: [c] }); return true; } catch { return false; } };
  let focus = false;
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) focus = await apply({ focusMode: 'continuous' });
  let zoom = null;
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    zoom = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: track.getSettings?.().zoom ?? caps.zoom.min };
    // zoom 1,5–2 : on tient le téléphone à ≈ 20 cm, la carte reste nette (distance minimale de mise au point)
    if (caps.zoom.max >= 1.5 && await apply({ zoom: Math.min(2, caps.zoom.max) })) zoom.value = track.getSettings?.().zoom ?? Math.min(2, caps.zoom.max);
  }
  if (abandon()) throw new CameraError('aborted', MESSAGES.aborted);
  cur = { stream, track, video, torch: false, zoom };
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  if (video.readyState < 1) {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new CameraError('unknown', MESSAGES.unknown)), 8000);
      video.addEventListener('loadedmetadata', () => { clearTimeout(t); res(); }, { once: true });
    }).catch(e => { closeCamera(); throw e; });
  }
  try { await video.play(); } catch { /* lecture automatique bloquée : la vidéo démarrera au premier geste */ }
  if (my !== gen) throw new CameraError('aborted', MESSAGES.aborted);     // fermée pendant le démarrage
  track.addEventListener('ended', () => { if (cur?.track === track) cur.ended = true; });
  return {
    stream,
    caps: { torch: !!caps.torch, zoom, focus, width: video.videoWidth, height: video.videoHeight },
  };
}

export function closeCamera() {
  gen++;
  if (!cur) return;
  for (const t of cur.stream.getTracks()) t.stop();
  if (cur.video && cur.video.srcObject === cur.stream) cur.video.srcObject = null;
  cur = null;
}

export const cameraOpen = () => !!cur && !cur.ended;
export const torchState = () => !!cur?.torch;

// Lampe : true si la consigne a été appliquée (l'état affiché suit notre propre valeur)
export async function setTorch(on) {
  if (!cur) return false;
  try {
    await cur.track.applyConstraints({ advanced: [{ torch: !!on }] });
    cur.torch = !!on;
    return true;
  } catch {
    return false;
  }
}

// Zoom : true si appliqué ; la valeur est bornée aux capacités de la caméra
export async function setZoom(z) {
  if (!cur?.zoom) return false;
  const { min, max } = cur.zoom, v = Math.max(min, Math.min(max, +z || min));
  try {
    await cur.track.applyConstraints({ advanced: [{ zoom: v }] });
    cur.zoom.value = v;
    return true;
  } catch {
    return false;
  }
}
