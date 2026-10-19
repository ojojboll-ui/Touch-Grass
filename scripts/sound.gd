extends Node
## The instrument's voice: Chordtroller's engine (gdext/, the GrassSynth
## class) on an AudioStreamPlayer, through a "Music" bus with Godot's reverb.
##
## Space or a right click strums a test sweep over the current chord, for
## hearing the sound without hands.


var synth: Object            # GrassSynth, or null if the extension did not load
var player: AudioStreamPlayer
var recorder: AudioEffectRecord
var spectrum: AudioEffectSpectrumAnalyzerInstance
var music := Vector3.ZERO       # low, mid, high loudness, smoothed, roughly 0..1
var _down := false


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
	var analyser := AudioEffectSpectrumAnalyzer.new()
	analyser.fft_size = AudioEffectSpectrumAnalyzer.FFT_SIZE_1024
	AudioServer.add_bus_effect(bus, analyser)
	spectrum = AudioServer.get_bus_effect_instance(bus, AudioServer.get_bus_effect_count(bus) - 1)

	synth = ClassDB.instantiate("GrassSynth")
	player = AudioStreamPlayer.new()
	player.stream = synth
	player.bus = "Music"
	add_child(player)
	player.play()
	synth.set_chord(0, 0)


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
	strum(_down)
	_down = not _down


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


## The music's loudness in three bands, for the grass to answer: the drone's
## low end, the strings' middle, the high partials. Decibels mapped 0..1 from
## -60 to -12 dB, quick to rise and slow to fall.
func _process(delta: float) -> void:
	if spectrum == null:
		return
	var bands := [Vector2(40, 250), Vector2(250, 2000), Vector2(2000, 9000)]
	var now := Vector3.ZERO
	for k in 3:
		var m := spectrum.get_magnitude_for_frequency_range(bands[k].x, bands[k].y)
		var db := linear_to_db(max(m.length(), 1e-6))
		now[k] = clampf((db + 60.0) / 48.0, 0.0, 1.0)
	for k in 3:
		var rate := 0.08 if now[k] > music[k] else 0.6
		music[k] = lerpf(music[k], now[k], 1.0 - exp(-delta / rate))
	RenderingServer.global_shader_parameter_set("music", music)


func _unhandled_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k and k.pressed and not k.echo and k.keycode == KEY_SPACE:
		test_strum()
	var b := event as InputEventMouseButton
	if b and b.pressed and b.button_index == MOUSE_BUTTON_RIGHT:
		test_strum()
