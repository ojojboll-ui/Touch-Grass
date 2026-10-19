# Borrowed from Chordtroller

`dsp/` and `music/` are copied unchanged from `../../chordtroller/Source`
(same author, standing permission to borrow its JUCE-free engines):

- `dsp/VoiceSpec.h`, `dsp/PluckVoice.h` — the Omnichord string and its four timbres
- `dsp/Ensemble.h` — the Juno chorus over the strings
- `dsp/TempoDelay.h` — the J-6 ping-pong delay
- `dsp/JunoVoice.h` — one Juno voice, used here for the drone (PAD patch)
- `music/ChordRing.h` — chords and the 13-string plate in the Omnichord's order

Change them in Chordtroller first if a fix belongs to both. Touch Grass's own
code is `GrassEngine.h` (the instrument) and `grass_synth.*` (the Godot glue).

## Building

`godot-cpp/` is not committed: clone it here at commit 2bb1acf
(`git clone https://github.com/godotengine/godot-cpp.git`, MIT). `build.bat`
dumps Godot 4.7.2's `extension_api.json`, generates the bindings with the
handtrack venv's Python (the Windows `python` alias is the Store stub) and
builds `../bin/touchgrass_audio.windows.template_debug.x86_64.dll` with MSVC
Build Tools 2022. Close Godot first: it locks the dll. `build.bat test` runs
the offline engine test.
