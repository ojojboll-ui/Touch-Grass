extends Node
## Five invisible strum plates stacked over the whole picture, one chord each,
## played by one hand. Each hand has its own StrumPlate node.
##
## The chords are a chain of thirds, so neighbouring plates share three notes
## and moving a hand up or down is a gentle step, never a jolt:
##     Fmaj7 / Am7 / Cmaj7 / Em7 / G      (top to bottom)
## Each plate has the Omnichord's 13 strings standing left to right across
## the whole width. The hand's height picks the plate, its sideways movement
## crosses the strings: every whole string passed since the last frame is
## plucked, delayed by how far into the frame the crossing fell, so a sweep
## sounds as even as the hand moved. A string just plucked is disarmed until
## the hand is a third of a string away, so a resting hand does not buzz it.

signal plucked(plate: int, string_index: int, velocity: float)

# root, quality (0 major, 1 minor, 2 seventh, 3 major seventh, 4 minor seventh), name
const CHORDS := [
	[5, 3, "Fmaj7"],
	[9, 4, "Am7"],
	[0, 3, "Cmaj7"],
	[4, 4, "Em7"],
	[7, 0, "G"],
]
# a soft colour per plate, for the light its strings leave in the grass
const COLORS := [
	Color(1.0, 0.78, 0.32), Color(1.0, 0.58, 0.45), Color(0.95, 0.5, 0.75),
	Color(0.62, 0.56, 1.0), Color(0.45, 0.75, 1.0),
]
const LEFT := 0.04            # screen x of the first string
const RIGHT := 0.96           # and the last
const REARM := 0.33           # strings of travel before a string can sound again
const BAND_HYSTERESIS := 0.18 # share of a plate's height past its edge before the hand changes plate

var synth: Object
var plate := -1               # the plate the hand is on, -1 when not playing
var last_pluck := -100.0      # seconds, Time-based, for the grass to know the hand is sounding
var _plates := []             # per chord, PackedInt32Array of 13 MIDI notes
var _prev := -1.0
var _armed := PackedByteArray()
var _speed := 0.0


func _ready() -> void:
	_armed.resize(16)
	_armed.fill(1)


func setup(synth_object: Object) -> void:
	synth = synth_object
	_plates.clear()
	for c in CHORDS:
		if synth and synth.has_method("get_plate"):
			_plates.append(synth.get_plate(c[0], c[1]))
		else:
			_plates.append(PackedInt32Array())


static func count() -> int:
	return CHORDS.size()


static func plate_name(k: int) -> String:
	return CHORDS[k][2] if k >= 0 else ""


## screen: the hand in the picture, 0..1 both ways.
## playing: present, not a fist and (in Doppa) down in the grass.
## depth: 0..1, how far into the grass; louder deeper.
func update(screen: Vector2, playing: bool, depth: float, delta: float) -> void:
	if not playing or synth == null or _plates.is_empty():
		plate = -1
		_prev = -1.0
		_speed = 0.0
		return
	var n_plates := count()
	var band := clampf(screen.y, 0.0, 0.9999) * n_plates
	var want := int(band)
	if plate < 0:
		plate = want
		_prev = -1.0
	elif want != plate:
		var into := band - float(plate)
		if into < -BAND_HYSTERESIS or into > 1.0 + BAND_HYSTERESIS:
			plate = want
			_prev = -1.0          # a new plate starts fresh, the move between plates plucks nothing
			_armed.fill(1)
	var notes: PackedInt32Array = _plates[plate]
	var n := notes.size()
	if n == 0:
		return
	var s := (screen.x - LEFT) / (RIGHT - LEFT) * float(n - 1)
	if _prev < 0.0:
		_prev = s
		return
	var moved := s - _prev
	_speed = lerpf(_speed, abs(moved) / max(delta, 1e-4), 0.25)
	if abs(moved) > 1e-5:
		var lo := maxi(int(ceil(min(_prev, s))), 0)
		var hi := mini(int(floor(max(_prev, s))), n - 1)
		var order := range(lo, hi + 1)
		if moved < 0.0:
			order.reverse()
		for k in order:
			if is_equal_approx(float(k), _prev) or _armed[k] == 0:
				continue
			var frac: float = clampf((float(k) - _prev) / moved, 0.0, 1.0)
			var vel := clampf(0.35 + 0.35 * clampf(_speed / 20.0, 0.0, 1.0) + 0.3 * depth, 0.15, 1.0)
			synth.pluck_note(notes[k], vel, frac * delta)
			_armed[k] = 0
			last_pluck = Time.get_ticks_msec() / 1000.0
			plucked.emit(plate, k, vel)
	for k in n:
		if _armed[k] == 0 and abs(s - float(k)) > REARM:
			_armed[k] = 1
	_prev = s


## 1 right after a pluck, fading to 0 over half a second: how much the hand is sounding.
func sounding() -> float:
	return exp(-(Time.get_ticks_msec() / 1000.0 - last_pluck) / 0.5)
