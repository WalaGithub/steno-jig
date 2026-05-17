/**
 * raw-steno-input.js
 * Browser-native raw steno chord capture for Steno Jig.
 *
 * Intercepts keydown/keyup events, maps QWERTY keys to the standard
 * Plover QWERTY steno layout, assembles chords, and fires a custom
 * "stenoChord" event on the document when all keys are released.
 *
 * NO theory, NO dictionary lookup — outputs raw WSI stroke strings
 * in standard steno order (e.g. "STKPWHRAO*EUFRPBLGTSDZ").
 *
 * Browser NKRO note:
 *   Chrome (and Chromium-based browsers) handles 6+ simultaneous keys
 *   well via its own NKRO implementation in most OS/keyboard combos.
 *   Firefox may ghost or drop keys beyond 3-6 simultaneous presses
 *   depending on the keyboard hardware and USB hub. For best results,
 *   recommend Chrome. There is no JavaScript workaround for hardware-
 *   level key rollover limits.
 *
 * Usage:
 *   Include this file with <script src="raw-steno-input.js"></script>
 *   Then call:
 *     RawStenoInput.enable()   — activates chord capture mode
 *     RawStenoInput.disable()  — deactivates, restores normal input
 *
 *   Listen for completed chords:
 *     document.addEventListener('stenoChord', function(e) {
 *       console.log(e.detail.stroke);   // e.g. "STPH"
 *       console.log(e.detail.keys);     // Set of steno key names held
 *     });
 *
 *   For real-time "keys currently held" display, listen for:
 *     document.addEventListener('stenoKeysHeld', function(e) {
 *       console.log(e.detail.stroke);   // partial stroke as keys are held
 *     });
 */

var RawStenoInput = (function() {

  // ─── Plover QWERTY → Steno key map ──────────────────────────────────────
  // Standard Plover QWERTY layout (Open Steno Project).
  // Keys that appear on both sides are disambiguated by position in the
  // steno order string (left-hand keys come before the vowels).
  //
  // QWERTY key → steno key name (using the position-qualified convention
  // where right-hand keys carry a '-' prefix in the internal name so we
  // can distinguish -F from left-F, etc.)
  //
  // Full layout:
  //   Number bar:  1 2 3 4 5 0 6 7 8 9
  //   Left hand:   q w e r t  (S T P H *)  — top row
  //                a s d f g  (S K W R *)  — bottom row
  //   Vowels:      c v        (A O)        — left thumbs
  //                n m        (E U)        — right thumbs  (note: actually b/n/m etc.)
  //   Right hand:  y u i o p  (* F P L T)  — top row
  //                h j k l ;  (* R B G S)  — bottom row
  //   Right pinky: [  ]       (T D)
  //                ' \        (S Z)         (note: varies by Plover config)
  //
  // Using the standard Plover QWERTY map:
  //   q  → S-   (left S)
  //   a  → S-   (left S, both q and a map to left S)
  //   w  → T-
  //   s  → K-
  //   e  → P-
  //   d  → W-
  //   r  → H-
  //   f  → R-
  //   t  → *    (left * key)
  //   g  → *    (also *, same key different finger)
  //   y  → *    (right * key — same steno key)
  //   h  → *
  //   c  → A
  //   v  → O
  //   n  → E    (some maps use b; Plover default is n)
  //   m  → U    (some maps use m)
  //   u  → -F
  //   j  → -R
  //   i  → -P
  //   k  → -B
  //   o  → -L
  //   l  → -G
  //   p  → -T
  //   ;  → -S
  //   [  → -D
  //   '  → -Z   (apostrophe)
  //
  // Number bar (hold `e` = #, then number keys):
  //   Actually in Plover the number bar is triggered by the number keys
  //   themselves while holding no special key. We implement the simple
  //   version: the backtick/1–0 row maps to the number bar.
  //   For simplicity we map `1` → #1, etc., but this conflicts with
  //   browser shortcuts; in practice the number bar is less common in
  //   QWERTY steno mode. We include it for completeness and let the
  //   user be aware.

  // Each entry: qwerty code → { key: stenoKeyName, side: 'left'|'vowel'|'right' }
  // stenoKeyName is the canonical name used in the STENO_ORDER string below.
  var QWERTY_MAP = {
    // Left hand
    'KeyQ': { key: 'S',  side: 'left'  },
    'KeyA': { key: 'S',  side: 'left'  },  // both q and a → left S
    'KeyW': { key: 'T',  side: 'left'  },
    'KeyS': { key: 'K',  side: 'left'  },
    'KeyE': { key: 'P',  side: 'left'  },
    'KeyD': { key: 'W',  side: 'left'  },
    'KeyR': { key: 'H',  side: 'left'  },
    'KeyF': { key: 'R',  side: 'left'  },
    'KeyT': { key: '*',  side: 'left'  },
    'KeyG': { key: '*',  side: 'left'  },
    // Vowels (thumbs)
    'KeyC': { key: 'A',  side: 'vowel' },
    'KeyV': { key: 'O',  side: 'vowel' },
    'KeyB': { key: '*',  side: 'vowel' },   // some layouts put * on B
    'KeyN': { key: 'E',  side: 'vowel' },   // Plover default
    'KeyM': { key: 'U',  side: 'vowel' },
    // Right hand (* also lives here)
    'KeyY': { key: '*',  side: 'right' },
    'KeyH': { key: '*',  side: 'right' },
    'KeyU': { key: '-F', side: 'right' },
    'KeyJ': { key: '-R', side: 'right' },
    'KeyI': { key: '-P', side: 'right' },
    'KeyK': { key: '-B', side: 'right' },
    'KeyO': { key: '-L', side: 'right' },
    'KeyL': { key: '-G', side: 'right' },
    'KeyP': { key: '-T', side: 'right' },
    'Semicolon': { key: '-S', side: 'right' },
    'BracketLeft': { key: '-D', side: 'right' },
    'Quote': { key: '-Z', side: 'right' },
    // Number bar — top row of number keys
    'Digit1': { key: '#', side: 'left' },
    'Digit2': { key: '#', side: 'left' },
    'Digit3': { key: '#', side: 'left' },
    'Digit4': { key: '#', side: 'left' },
    'Digit5': { key: '#', side: 'left' },
    'Digit0': { key: '#', side: 'left' },
    'Digit6': { key: '#', side: 'right' },
    'Digit7': { key: '#', side: 'right' },
    'Digit8': { key: '#', side: 'right' },
    'Digit9': { key: '#', side: 'right' },
  };

  // Canonical steno key order for building stroke strings.
  // All keys in this array in order — we build the stroke by scanning
  // this list and including keys that are in the current chord set.
  // This produces standard WSI order: #STKPWHRAO*EUFRPBLGTSDZ
  var STENO_ORDER = ['#', 'S', 'T', 'K', 'P', 'W', 'H', 'R', 'A', 'O', '*', 'E', 'U', '-F', '-R', '-P', '-B', '-L', '-G', '-T', '-S', '-D', '-Z'];

  // When rendering the stroke string for output, right-side keys drop
  // their '-' prefix. The '-' only appears in the middle of a stroke
  // when there are no vowels (e.g. "S-T" not "ST").
  // This follows the standard steno stroke string convention.

  /**
   * Convert a Set of steno key names (from STENO_ORDER) to a stroke string.
   * Rules:
   *   1. Scan STENO_ORDER left-to-right, include keys present in the set.
   *   2. Strip '-' prefix from right-hand keys in the output.
   *   3. If there are right-hand keys but no vowels and no *, insert '-'
   *      after the last left-hand key.
   */
  function keysToStroke(keySet) {
    if (keySet.size === 0) return '';

    var hasVowel = keySet.has('A') || keySet.has('O') || keySet.has('E') || keySet.has('U') || keySet.has('*');
    var hasRight = false;
    for (var i = 0; i < STENO_ORDER.length; i++) {
      var k = STENO_ORDER[i];
      if (k[0] === '-' && keySet.has(k)) { hasRight = true; break; }
    }

    var needsSeparator = !hasVowel && hasRight;
    var stroke = '';
    var separatorInserted = false;

    for (var i = 0; i < STENO_ORDER.length; i++) {
      var k = STENO_ORDER[i];
      if (!keySet.has(k)) continue;

      // Insert '-' separator before first right-hand key if needed
      if (needsSeparator && !separatorInserted && k[0] === '-') {
        stroke += '-';
        separatorInserted = true;
      }

      // Strip the '-' prefix for display
      stroke += (k[0] === '-') ? k.slice(1) : k;
    }

    return stroke;
  }

  // ─── State ───────────────────────────────────────────────────────────────

  var enabled = false;
  var keysDown = new Set();   // Set of steno key names currently physically held
  var chordKeys = new Set();  // Accumulated keys for the current chord (superset
                               // of keysDown — keys added on press, never removed
                               // until the chord fires on full release)
  var physicalKeysDown = 0;   // Count of physical QWERTY keys currently pressed
                               // (to detect "all keys released")

  // ─── Event handlers ──────────────────────────────────────────────────────

  function onKeyDown(e) {
    if (!enabled) return;

    var mapped = QWERTY_MAP[e.code];
    if (!mapped) return;

    // Prevent the key from typing into any focused input
    e.preventDefault();
    e.stopPropagation();

    physicalKeysDown++;
    chordKeys.add(mapped.key);
    keysDown.add(mapped.key);

    // Fire a "keys held" event so the display can update in real time
    fireHeldEvent();
  }

  function onKeyUp(e) {
    if (!enabled) return;

    var mapped = QWERTY_MAP[e.code];
    if (!mapped) return;

    e.preventDefault();
    e.stopPropagation();

    physicalKeysDown = Math.max(0, physicalKeysDown - 1);
    keysDown.delete(mapped.key);

    if (physicalKeysDown === 0) {
      // All keys released — fire the completed chord
      fireChordEvent();
      chordKeys = new Set();
      keysDown = new Set();
    }
  }

  // Defensive cleanup: if the window loses focus mid-chord, reset state
  // so we don't get a phantom chord when the user returns.
  function onBlur() {
    if (!enabled) return;
    physicalKeysDown = 0;
    keysDown = new Set();
    chordKeys = new Set();
    fireHeldEvent(); // clear the live display
  }

  function fireChordEvent() {
    var stroke = keysToStroke(chordKeys);
    if (!stroke) return;
    var event = new CustomEvent('stenoChord', {
      bubbles: true,
      detail: {
        stroke: stroke,
        keys: new Set(chordKeys)
      }
    });
    document.dispatchEvent(event);
  }

  function fireHeldEvent() {
    // Build a partial stroke from currently-held keys (keysDown), but
    // also include any keys from chordKeys that were held earlier in
    // this chord (for display continuity).
    var combined = new Set(chordKeys);
    var stroke = keysToStroke(combined);
    var event = new CustomEvent('stenoKeysHeld', {
      bubbles: true,
      detail: {
        stroke: stroke,
        keys: new Set(combined)
      }
    });
    document.dispatchEvent(event);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  function enable() {
    if (enabled) return;
    enabled = true;
    // Use capture phase so we intercept before the input element sees them
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup',   onKeyUp,   true);
    window.addEventListener('blur', onBlur);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup',   onKeyUp,   true);
    window.removeEventListener('blur', onBlur);
    // Reset state
    physicalKeysDown = 0;
    keysDown = new Set();
    chordKeys = new Set();
  }

  function isEnabled() {
    return enabled;
  }

  // Expose the key map and order for external tools (e.g. key-map display)
  return {
    enable:        enable,
    disable:       disable,
    isEnabled:     isEnabled,
    keysToStroke:  keysToStroke,
    QWERTY_MAP:    QWERTY_MAP,
    STENO_ORDER:   STENO_ORDER,
  };

})();
