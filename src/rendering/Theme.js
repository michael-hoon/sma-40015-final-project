/**
 * @fileoverview Visual theme constants for the isometric ward render.
 * All hex values are Pixi-format integers (0xRRGGBB).
 *
 * Palette: warm light clinical — sage green accent, soft pastels for
 * special cells, near-ink for agent outlines on light backgrounds.
 */
export const THEME = {
  // ── Floor / corridor ────────────────────────────────────────────────────────
  floor:          0xF5F5F4,   // warm stone-100 (even cells)
  floorAlt:       0xEFEFED,   // slightly cooler (odd cells — subtle checkerboard)

  // ── Walls ───────────────────────────────────────────────────────────────────
  wallTop:        0xA8A29E,   // top face
  wallLeft:       0x8C8682,   // left/SW face (lighter — faces ambient)
  wallRight:      0x706A66,   // right/SE face (darker — in shadow)

  // ── Special cells — top face, left face, right face ─────────────────────────
  nurseStTop:     0xD1FAE5,   // mint green tint
  nurseStLeft:    0xA8E0C2,
  nurseStRight:   0x82C9A0,

  chargingTop:    0xFEF9C3,   // warm amber tint
  chargingLeft:   0xE8E0A0,
  chargingRight:  0xC9C080,

  entranceTop:    0xDBEAFE,   // pale sky (only deliberate blue in the palette)
  entranceLeft:   0xB6CCEC,
  entranceRight:  0x90AED6,

  // ── Bed ─────────────────────────────────────────────────────────────────────
  bedTop:         0xFFFFFF,
  bedLeft:        0xF0EEE8,
  bedRight:       0xDDDAD2,
  mattressTop:    0xF7F4EC,
  bedPillow:      0xE4EAF1,

  // ── Agents ──────────────────────────────────────────────────────────────────
  patient:        0xFFFFFF,
  patientStroke:  0x1C1917,   // near-ink for contrast on warm-white bg
  nurse:          0x5F9B7C,   // sage — matches UI --accent
  medi:           0x4F92B5,   // muted slate-blue
  blanki:         0xE39B6B,   // warm coral
  edi:            0x9B7FB8,   // muted violet
  agentStroke:    0xFFFFFF,   // white ring for contrast on light bg

  // ── Health / battery bars ───────────────────────────────────────────────────
  healthOk:       0x6DAE85,
  healthWarn:     0xE3B96B,
  healthCrit:     0xEF4444,   // soft coral red
  barTrack:       0xE7E5E4,

  // ── Need indicator dots ─────────────────────────────────────────────────────
  emergency:      0xEF4444,   // soft coral
  medication:     0x4F92B5,   // slate blue
  comfort:        0xE3AA55,   // warm amber
  visitor_escort: 0x9B7FB8,   // muted violet

  // ── Inventory pip colours ────────────────────────────────────────────────────
  medicine:       0x7DD3FC,   // sky-300
  blanket:        0xFCD34D,   // amber-300
  invTrack:       0xE7E5E4,
  invRefill:      0xA8A29E,
};
