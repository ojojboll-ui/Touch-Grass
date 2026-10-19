extends Node
## The instrument's voice: Chordtroller's engine (gdext/, the GrassSynth
## class) on an AudioStreamPlayer, through a "Music" bus with Godot's reverb.
##
## Until the strings lie in the grass (stage 4) Space or a right click strums a
## test sweep and steps through a little progression, so the sound can be heard
## and judged. The status line names each chord, which shows the key arrived.

const PROGRESSION := [[0, 0], [9, 1], [5, 0], [7, 2]]   # C, Am, F, G7  (root, quality)
const NAMES := ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
const SUFFIX := ["", "m", "7"]

var synth: Object            # GrassSynth, or null if the extension did not load
var player: AudioStreamPlayer
var recorder: AudioEffectRecord
var _step := 0
var _down := false
var last_chord := ""


func _ready() -> void:
	if not ClassDB.class_exists("GrassSynth"):
		push_warning("GrassSynth missing: build gdext/ (build.bat) and import the project once")
		return
	var bus := AudioServer.bus_count
	AudioServer.add_bus(bus)
	AudioServer.set_bus_name(bus, "Music")
	AudioServer.set_bus_send(bus, "Master")
	var reverb := AudioEffectReverb.new()
	reverb.room_size = 0.85
	reverb.damping = 0.45
	reverb.spread = 1.0
	reverb.hipass = 0.12
	reverb.predelay_msec = 40.0
	reverb.dry = 0.9
	reverb.wet = 0.32
	AudioServer.add_bus_effect(bus, reverb)

	synth = ClassDB.instantiate("GrassSynth")
	player = AudioStreamPlayer.new()
	player.stream = synth
	player.bus = "Music"
	add_child(player)
	player.play()
	synth.set_chord(PROGRESSION[0][0], PROGRESSION[0][1])


## Sweep every string, `spread` seconds apart, up or down the plate.
func strum(down: bool, spread := 0.045, velocity := 0.7) -> void:
	if synth == null:
		return
	var n: int = synth.get_string_count()
	for k in n:
		synth.pluck(n - 1 - k if down else k, velocity, k * spread)


func test_strum() -> void:
	if synth == null:
		return
	var c: Array = PROGRESSION[_step % PROGRESSION.size()]
	synth.set_chord(c[0], c[1])
	last_chord = NAMES[c[0]] + SUFFIX[c[1]]
	strum(_down)
	_down = not _down
	_step += 1


## Capture the Master bus, for tests (--wav=path).
func start_recording() -> void:
	recorder = AudioEffectRecord.new()
	AudioServer.add_bus_effect(0, recorder)
	recorder.set_recording_active(true)


func save_recording(path: String) -> void:
	if recorder == null:
		return
	recorder.set_recording_active(false)
	var wav := recorder.get_recording()
	if wav:
		wav.save_to_wav(path)


func _unhandled_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k and k.pressed and not k.echo and k.keycode == KEY_SPACE:
		test_strum()
	var b := event as InputEventMouseButton
	if b and b.pressed and b.button_index == MOUSE_BUTTON_RIGHT:
		test_strum()
