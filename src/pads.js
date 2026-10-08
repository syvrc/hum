// Pads = the "buttons" on the table. Each pad is one (zone, tap type) pair that Hum
// learns as its own class. Zones are positions around the phone as seen from the user
// (sitting at the bottom edge of the screen).

export const ZONES = {
  left: { label: 'LEFT', where: 'left of the phone, about a hand-width (15–20 cm) away', x: 0.15, y: 0.5 },
  right: { label: 'RIGHT', where: 'right of the phone, about a hand-width (15–20 cm) away', x: 0.85, y: 0.5 },
  near: { label: 'NEAR', where: 'between you and the phone, 15–20 cm below it', x: 0.5, y: 0.83 },
  far: { label: 'FAR', where: 'beyond the top of the phone, 15–20 cm away', x: 0.5, y: 0.14 },
};

export const TAP_TYPES = {
  palm: { label: 'PALM', how: 'slap with a flat palm' },
  knuckle: { label: 'KNUCKLE', how: 'knock with one knuckle' },
  nail: { label: 'NAIL', how: 'tap with a fingernail' },
  fist: { label: 'FIST', how: 'bump with the side of a closed fist' },
};

// Phase 0 experiment presets. "Mixed 4" is the default; the other two isolate
// location and tap type so one session answers the go/no-go question (brief §6).
export const PRESETS = [
  { id: 'mixed4', name: 'Mixed 4', note: 'Location + tap type (default)', pads: ['left:palm', 'right:palm', 'near:knuckle', 'far:knuckle'] },
  { id: 'loc4', name: 'Location 4', note: 'Knuckle everywhere — pure location test', pads: ['left:knuckle', 'right:knuckle', 'near:knuckle', 'far:knuckle'] },
  { id: 'type4', name: 'Type 4', note: 'One spot, four tap types — Plan B test', pads: ['right:palm', 'right:knuckle', 'right:nail', 'right:fist'] },
];

export function makePad(id) {
  const [zone, type] = id.split(':');
  const z = ZONES[zone];
  const t = TAP_TYPES[type];
  return { id, zone, type, label: `${z.label} · ${t.label}`, short: `${z.label[0]}·${t.label}`, where: z.where, how: t.how };
}

export function presetPads(presetId) {
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  return preset.pads.map(makePad);
}
