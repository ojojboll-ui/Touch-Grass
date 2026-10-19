# Touch Grass

A meditative instrument: a Flower-like meadow of long grass seen from above,
played with your hands in front of a webcam. Invisible Omnichord strum plates
lie over the whole picture; sweep a hand sideways to pluck, raise or lower it
to change chord. The grass parts round your glass hands, rings of light run
out from every plucked string, and the meadow breathes with the music.

## Run

Windows, Godot 4.7.2 at `..\..\Downloads\Godot_v4.7.2-stable_win64.exe\`
(edit `run.bat` if yours is elsewhere), and the sibling `handtrack` project
(MediaPipe hand tracking with its own `.venv`) at `../handtrack`.

```
run.bat
```

Touch Grass starts handtrack itself (OSC on UDP 9000, so close Chordtroller or
Handsynt first) and stops it on exit.

## Playing

- **Both hands strum.** Five plates stacked top to bottom, a chain of thirds
  that share notes: Fmaj7, Am7, Cmaj7, Em7, G. Each has the Omnichord's 13
  strings across the full width.
- **Depth** (toward the webcam) presses the grass harder and makes the strings
  louder and brighter. A fist is silent and lifts the hand out of the grass.
- **Keys:** C or 1-4 camera views, H hide the panel, F fullscreen, D toggle
  dip-to-play, Space or right click strums a test sweep. With no hands in view
  the mouse strums while its left button is held.

## Layout

- `scripts/` — the scene, built in code from `main.gd`: grass field, terrain,
  sky and time of day, camera views, hands (`hand_input.gd` reads OSC,
  `hand_view.gd` poses the hand model), strum plates, ripples, pollen.
- `shaders/` — grass, ground, sky, glass hand, bend field.
- `gdext/` — the sound: Chordtroller's Omnichord engine as a GDExtension
  (see `gdext/src/BORROWED.md` for how to build it). The built dll is in `bin/`.
- `tools/fake_hands.py` — synthetic hands over OSC for tests without a camera.
- `snap.sh` — render a frame to `shots/` (`--cam=0..3 --hour= --nolaunch`).

## Credits

- Hand models: Godot XR Tools hands by DigitalN8m4r3 (CC0), made with MakeHuman.
- Wind technique after Malido's Stylized Multimesh Grass Shader (CC0) and
  hexaquo.at's grass rendering series.
- godot-cpp (MIT) for the extension bindings.
