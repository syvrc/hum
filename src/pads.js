// What Hum learns and what it listens for.
//
// SOUNDS (the classifier's classes): tap TYPES — palm and knuckle — tapped ANYWHERE on
// the table. (The first prototype also tried to learn tap LOCATIONS around the phone;
// on a real table, with one microphone lying on it, left/right/near/far sounded too
// alike, so Hum switched to the brief's Plan B: tap type × number of taps.)
//
// COMMANDS: a tap type × a count of 1–3 taps → 6 commands, each with a phrase.

export const TAP_TYPES = {
  palm: { label: 'PALM', icon: '✋', how: 'slap with a flat, relaxed palm' },
  knuckle: { label: 'KNUCKLE', icon: '✊', how: 'knock with one bony knuckle' },
  nail: { label: 'NAIL', icon: '☝', how: 'tap with a fingernail' },
  fist: { label: 'FIST', icon: '👊', how: 'bump with the side of a closed fist' },
};

export const DEFAULT_TYPES = ['palm', 'knuckle'];
export const MAX_COUNT = 3;
export const WHERE = 'anywhere on the table within easy reach — move around a little between taps';

// Legacy (Phase 0–2) location zones, kept only so old saved tables can still be read.
export const ZONES = {
  left: { label: 'LEFT', where: 'left of the phone' },
  right: { label: 'RIGHT', where: 'right of the phone' },
  near: { label: 'NEAR', where: 'between you and the phone' },
  far: { label: 'FAR', where: 'beyond the top of the phone' },
};

export const isLegacyPadId = (id) => String(id).includes(':');

/** A sound class: a tap type (new), or a legacy "zone:type" pad from early prototypes. */
export function makePad(id) {
  if (isLegacyPadId(id)) {
    const [zone, type] = id.split(':');
    const z = ZONES[zone] || { label: zone.toUpperCase(), where: '' };
    const t = TAP_TYPES[type] || { label: type.toUpperCase(), icon: '', how: '' };
    return { id, zone, type, legacy: true, icon: t.icon, label: `${z.label} · ${t.label}`, short: `${z.label[0]}·${t.label}`, where: z.where, how: t.how };
  }
  const t = TAP_TYPES[id];
  return { id, zone: null, type: id, icon: t.icon, label: t.label, short: t.label, where: WHERE, how: t.how };
}

export const commandId = (type, count) => `${type}${count}`;

/** All commands for these tap types: palm×1, knuckle×1, palm×2, … (ordered by count). */
export function makeCommands(types = DEFAULT_TYPES, maxCount = MAX_COUNT) {
  const out = [];
  for (let count = 1; count <= maxCount; count++) for (const type of types) out.push({ id: commandId(type, count), type, count });
  return out;
}

/** "✋ ×2" — used everywhere a command is shown. */
export const patternText = (cmd) => `${TAP_TYPES[cmd.type]?.icon || ''} ×${cmd.count}`;
export const patternWords = (cmd) => `${TAP_TYPES[cmd.type]?.label.toLowerCase()} ${cmd.count === 1 ? 'once' : cmd.count === 2 ? 'twice' : `${cmd.count} times`}`;
