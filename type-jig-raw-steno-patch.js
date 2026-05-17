/**
 * type-jig-raw-steno-patch.js
 *
 * Non-breaking patch that adds Raw Steno input mode to TypeJig.
 * Include this AFTER type-jig.js and raw-steno-input.js.
 *
 * It monkey-patches TypeJig to:
 *   1. Add an "input mode" toggle UI (radio buttons) above the drill input.
 *   2. When "Raw Steno" mode is active, intercept stenoChord events and
 *      compare the stroke string against the next expected word.
 *   3. Reuse StenoDisplay (if present on the page) to show the held chord
 *      in real time via stenoKeysHeld events.
 *   4. Leave all existing Plover-software mode behaviour untouched.
 *
 * Usage:
 *   In your HTML, after the existing scripts:
 *
 *   <script src="raw-steno-input.js"></script>
 *   <script src="type-jig-raw-steno-patch.js"></script>
 *
 *   Then add a container for the live chord display somewhere visible:
 *   <div id="raw-steno-display"></div>
 *
 *   And (optionally) a div for the mode toggle:
 *   <div id="input-mode-toggle"></div>
 *
 *   The patch will auto-insert the toggle if neither element exists yet.
 */

(function() {
  'use strict';

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── Live steno display integration ──────────────────────────────────────
  // We look for a StenoDisplay on the page identified by id="raw-steno-display".
  // If the page already constructed one, we reuse it; otherwise we build one.

  var liveDisplay = null;   // StenoDisplay instance for real-time chord preview
  var activeTypeJig = null; // The TypeJig instance currently running

  function init() {
    // Inject the mode toggle UI and wire up the chord listener.
    // The actual TypeJig instances are constructed by page-level scripts,
    // so we patch the TypeJig constructor to register each new instance.
    patchTypeJigConstructor();
    wireChordListener();
    injectStyles();
  }

  // ─── Patch TypeJig constructor ────────────────────────────────────────────

  function patchTypeJigConstructor() {
    var OrigTypeJig = TypeJig;

    TypeJig = function(exercise, display, results, input, clock, hint, options) {
      // Call original
      OrigTypeJig.call(this, exercise, display, results, input, clock, hint, options);
      activeTypeJig = this;

      // Build the mode toggle UI near the input area
      var inputElt = documentElement(input);
      if (inputElt && !document.getElementById('steno-mode-toggle')) {
        buildModeToggle(inputElt);
      }

      // Build or locate the live chord display
      setupLiveDisplay();
    };

    // Copy prototype and static members
    TypeJig.prototype = OrigTypeJig.prototype;
    TypeJig.prototype.constructor = TypeJig;
    for (var key in OrigTypeJig) {
      if (Object.prototype.hasOwnProperty.call(OrigTypeJig, key)) {
        TypeJig[key] = OrigTypeJig[key];
      }
    }
  }

  // ─── Mode toggle UI ───────────────────────────────────────────────────────

  function buildModeToggle(anchorElt) {
    var wrapper = document.createElement('div');
    wrapper.id = 'steno-mode-toggle';
    wrapper.className = 'steno-mode-toggle';
    wrapper.innerHTML =
      '<span class="steno-mode-label">Input mode:</span>' +
      '<label class="steno-mode-option">' +
        '<input type="radio" name="steno-mode" value="plover" checked> ' +
        'Plover / software' +
      '</label>' +
      '<label class="steno-mode-option">' +
        '<input type="radio" name="steno-mode" value="raw"> ' +
        'Raw steno (QWERTY)' +
      '</label>';

    // Insert before the input element's parent section, or just before input
    var parent = anchorElt.parentNode;
    parent.insertBefore(wrapper, anchorElt);

    wrapper.addEventListener('change', function(e) {
      if (e.target.name !== 'steno-mode') return;
      if (e.target.value === 'raw') {
        activateRawMode();
      } else {
        deactivateRawMode();
      }
    });
  }

  // ─── Raw steno mode activate / deactivate ─────────────────────────────────

  var rawModeActive = false;

  function activateRawMode() {
    if (rawModeActive) return;
    rawModeActive = true;
    RawStenoInput.enable();

    // Hide the normal text input so it doesn't receive stray characters.
    // We do NOT remove it — TypeJig still manages its internal state via it.
    var inputElt = activeTypeJig && activeTypeJig.input;
    if (inputElt) {
      inputElt.style.opacity = '0';
      inputElt.style.pointerEvents = 'none';
      inputElt.setAttribute('aria-hidden', 'true');
    }

    // Show the live chord display container
    if (liveDisplay && liveDisplay.container) {
      liveDisplay.container.style.display = '';
    }

    var notice = document.getElementById('raw-steno-notice');
    if (notice) notice.style.display = '';
  }

  function deactivateRawMode() {
    if (!rawModeActive) return;
    rawModeActive = false;
    RawStenoInput.disable();

    // Restore normal input
    var inputElt = activeTypeJig && activeTypeJig.input;
    if (inputElt) {
      inputElt.style.opacity = '';
      inputElt.style.pointerEvents = '';
      inputElt.removeAttribute('aria-hidden');
      inputElt.focus();
    }

    // Hide live display
    if (liveDisplay && liveDisplay.container) {
      liveDisplay.container.style.display = 'none';
    }

    var notice = document.getElementById('raw-steno-notice');
    if (notice) notice.style.display = 'none';
  }

  // ─── Live chord display setup ─────────────────────────────────────────────

  function setupLiveDisplay() {
    // Look for an existing container; create one if absent
    var container = document.getElementById('raw-steno-display');
    if (!container) {
      container = document.createElement('div');
      container.id = 'raw-steno-display';
      container.style.display = 'none';
      // Insert after the mode toggle if present, else after body
      var toggle = document.getElementById('steno-mode-toggle');
      if (toggle && toggle.parentNode) {
        toggle.parentNode.insertBefore(container, toggle.nextSibling);
      } else {
        document.body.appendChild(container);
      }
    }

    // Create a StenoDisplay if the class is available and we haven't yet
    if (typeof StenoDisplay !== 'undefined' && !liveDisplay) {
      // StenoDisplay normally needs a translations dict; we pass {} since
      // we call .set() directly with a raw stroke string.
      liveDisplay = new StenoDisplay(container, {}, true);
    }

    // Add a small notice label
    if (!document.getElementById('raw-steno-notice')) {
      var notice = document.createElement('p');
      notice.id = 'raw-steno-notice';
      notice.className = 'raw-steno-notice';
      notice.textContent = 'Raw steno mode active — type chords on your QWERTY keyboard (Plover not needed).';
      notice.style.display = 'none';
      container.parentNode && container.parentNode.insertBefore(notice, container);
    }
  }

  // ─── Chord event listener ─────────────────────────────────────────────────

  function wireChordListener() {
    // Real-time key-held preview → update StenoDisplay
    document.addEventListener('stenoKeysHeld', function(e) {
      if (!rawModeActive) return;
      if (liveDisplay) {
        var stroke = e.detail.stroke;
        if (stroke) {
          // StenoDisplay.set() wants a pseudo-steno string; our stroke
          // is already in standard steno format, which pseudoStrokeToSteno
          // in steno-display.js can handle.
          liveDisplay.set(stroke, true);
        } else {
          liveDisplay.set('', false);
        }
      }
    });

    // Completed chord → inject into TypeJig as if the user typed it
    document.addEventListener('stenoChord', function(e) {
      if (!rawModeActive || !activeTypeJig) return;
      var stroke = e.detail.stroke;
      if (!stroke) return;

      // Clear the live display
      if (liveDisplay) liveDisplay.set('', false);

      // Delegate to the drill's stroke handler
      handleStrokeInDrill(stroke);
    });
  }

  /**
   * Inject a completed steno stroke into the active TypeJig drill.
   *
   * Strategy: we manipulate the hidden text input to append/replace the
   * current typed value, then trigger an 'input' event so TypeJig's own
   * answerChanged() fires normally. This means all of TypeJig's existing
   * scoring, cursor, and progress logic runs unchanged.
   *
   * In raw steno mode, each "word" in the exercise corresponds to one
   * stroke. We append the stroke string followed by a space, so TypeJig
   * advances to the next word.
   *
   * For stroke-by-stroke drills (stroke IS the expected word), this works
   * perfectly. For word/phrase drills, users will see the raw stroke
   * string compared against the English word — which is the intended
   * "no theory" behaviour: the drill shows you what stroke you should
   * produce, and you practice hitting it exactly.
   */
  function handleStrokeInDrill(stroke) {
    var jig = activeTypeJig;
    if (!jig || !jig.input) return;

    var input = jig.input;

    // Determine if we should replace the last token or append a new one.
    // Simple heuristic: if the current value ends with a space (or is empty),
    // we're starting a new token. Otherwise replace the current partial token.
    var current = input.value;
    var endsWithSpace = current === '' || current[current.length - 1] === ' ';

    if (endsWithSpace) {
      // Append new stroke token
      input.value = current + stroke + ' ';
    } else {
      // Replace the partial token at the end
      var lastSpace = current.lastIndexOf(' ');
      input.value = (lastSpace >= 0 ? current.slice(0, lastSpace + 1) : '') + stroke + ' ';
    }

    // Trigger TypeJig's input handler
    var event = new Event('input', { bubbles: true });
    // Inject a timestamp so TypeJig's chord timing works
    Object.defineProperty(event, 'timeStamp', { value: performance.now() });
    input.dispatchEvent(event);
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('raw-steno-styles')) return;
    var style = document.createElement('style');
    style.id = 'raw-steno-styles';
    style.textContent = [
      '.steno-mode-toggle {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 1em;',
      '  margin: 0.5em 0;',
      '  font-size: 0.9em;',
      '}',
      '.steno-mode-label {',
      '  font-weight: bold;',
      '  white-space: nowrap;',
      '}',
      '.steno-mode-option {',
      '  cursor: pointer;',
      '  white-space: nowrap;',
      '}',
      '#raw-steno-display {',
      '  margin: 0.5em 0;',
      '}',
      '.raw-steno-notice {',
      '  font-size: 0.8em;',
      '  opacity: 0.7;',
      '  margin: 0.25em 0;',
      '  font-style: italic;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ─── Helper (duplicated from type-jig.js to avoid dependency) ─────────────
  function documentElement(elt) {
    if (typeof elt === 'string') elt = document.getElementById(elt);
    return elt;
  }

})();
