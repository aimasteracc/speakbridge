export const palettes = {
  paper: { name: '雾白', detail: '干净、中性，专注于内容', scheme: 'light', canvas: '#f5f6f8', surface: '#ffffff', subtle: '#f0f2f5', text: '#242934', muted: '#606978', line: '#dce1e8', accent: '#39465e', soft: '#e9edf4', onAccent: '#ffffff' },
  sand: { name: '暖砂', detail: '柔和暖色，像翻开一本书', scheme: 'light', canvas: '#f5f1e9', surface: '#fffcf7', subtle: '#eee7db', text: '#383129', muted: '#726351', line: '#ded3c3', accent: '#86552e', soft: '#f0e1d0', onAccent: '#ffffff' },
  sage: { name: '松绿', detail: '低饱和绿色，安静而清晰', scheme: 'light', canvas: '#f0f5f1', surface: '#fbfdfb', subtle: '#e7eee9', text: '#243a30', muted: '#556c5e', line: '#cfddd3', accent: '#30674b', soft: '#dcece1', onAccent: '#ffffff' },
  ocean: { name: '海蓝', detail: '清透的蓝，适合日常工作', scheme: 'light', canvas: '#f0f4fa', surface: '#ffffff', subtle: '#e8eef7', text: '#23324b', muted: '#566a86', line: '#d1dceb', accent: '#285eb2', soft: '#dfeafb', onAccent: '#ffffff' },
  night: { name: '深夜', detail: '深色背景，保留清晰的层次', scheme: 'dark', canvas: '#15191f', surface: '#20262f', subtle: '#2a323e', text: '#edf1f7', muted: '#abb7c8', line: '#414d5f', accent: '#b1c8ef', soft: '#303e55', onAccent: '#18243a' },
} as const;
export type PaletteId = keyof typeof palettes;
export type Appearance = PaletteId | 'system';
export const APPEARANCE_KEY = 'speakbridge.appearance.v1';
export function validAppearance(value: unknown): Appearance {
  return value === 'system' || (typeof value === 'string' && Object.hasOwn(palettes, value)) ? value as Appearance : 'system';
}
export function resolveAppearance(value: Appearance, dark: boolean): PaletteId {
  return value === 'system' ? (dark ? 'night' : 'paper') : value;
}
export function readAppearance(storage: Pick<Storage, 'getItem'>): Appearance {
  try { return validAppearance(storage.getItem(APPEARANCE_KEY)); } catch { return 'system'; }
}
let preference: Appearance = 'system';
let media: MediaQueryList | undefined;
const listeners = new Set<() => void>();
function applyAppearance() {
  const id = resolveAppearance(preference, media?.matches ?? false);
  const palette = palettes[id];
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = palette.scheme;
  for (const [name, color] of Object.entries(palette)) {
    if (color.startsWith('#')) root.style.setProperty('--ui-' + name, color);
  }
  root.style.setProperty('--ui-danger', id === 'night' ? '#ffb4ab' : '#a3312a');
  root.style.setProperty('--ui-danger-soft', id === 'night' ? '#452a2c' : '#fff0ed');
  root.style.setProperty('--ui-danger-button', id === 'night' ? '#9f352e' : '#a3312a');
  for (const listener of listeners) listener();
}
export function initializeAppearance() {
  try { preference = readAppearance(window.localStorage); } catch { preference = 'system'; }
  media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => { if (preference === 'system') applyAppearance(); });
  window.addEventListener('storage', event => {
    if (event.key === APPEARANCE_KEY || event.key === null) { preference = validAppearance(event.newValue); applyAppearance(); }
  });
  applyAppearance();
}
export const getAppearance = () => preference;
export function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setAppearance(value: Appearance): boolean {
  preference = validAppearance(value);
  let saved = true;
  try { window.localStorage.setItem(APPEARANCE_KEY, preference); } catch { saved = false; }
  applyAppearance();
  return saved;
}
